import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  LAUNCHER_SHOW_ON,
  LAUNCHER_TERMINALS,
  runSummary,
  type LauncherAction,
  type LauncherConfigError,
  type LauncherProject,
  type LaunchersConfig,
  type LauncherShowOn,
  type SkillInfo
} from '../../shared/launchers'
import { useT } from '../i18n'
import { publishLaunchers, reloadLaunchers, useLaunchers } from '../useLaunchers'
import { ConfirmRow } from './ConfirmRow'
import { Segmented } from './Segmented'

const api = window.prRadar

type Removing = { kind: 'project' | 'action'; id: string } | null

const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function useErrorText() {
  const t = useT()
  return (e: LauncherConfigError) => t(`launchers.error.${e.code}`, { at: e.at, detail: e.detail ?? '' })
}

/** Settings → "Send to agent": the terminal, the projects and the actions of the PR menu. */
export function LaunchersView() {
  const t = useT()
  const errorText = useErrorText()
  const view = useLaunchers()
  const [skills, setSkills] = useState<Record<string, SkillInfo[]>>({})
  const [projectError, setProjectError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<LauncherAction | null>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [saveErrors, setSaveErrors] = useState<LauncherConfigError[]>([])

  useEffect(reloadLaunchers, [])
  const projectIds = view?.config.projects.map((p) => p.id).join(',') ?? ''
  // Skills are read from disk per project: once when the project appears, again after Detect.
  useEffect(() => {
    for (const id of projectIds.split(',').filter(Boolean)) {
      if (!(id in skills)) loadSkills(id)
    }
  }, [projectIds])

  if (!view) return <main className="settings" />
  const config = view.config

  function loadSkills(projectId: string) {
    void api.launchers.skills(projectId).then((list) => setSkills((s) => ({ ...s, [projectId]: list })))
  }
  const save = async (next: LaunchersConfig): Promise<boolean> => {
    const result = await api.launchers.save(next)
    if (result.ok) {
      publishLaunchers(result.view)
      setSaveErrors([])
      return true
    }
    setSaveErrors(result.errors)
    return false
  }
  const projectAction = async (key: string, run: () => ReturnType<typeof api.launchers.addProject>) => {
    setBusy(key)
    setProjectError(null)
    try {
      const result = await run()
      if (result.ok) {
        publishLaunchers(result.view)
        loadSkills(result.projectId)
      } else if (result.code !== 'cancelled') {
        setProjectError(t(`launchers.project.error.${result.code}`))
      }
    } finally {
      setBusy(null)
    }
  }
  const renameProject = (project: LauncherProject, name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name) return
    void save({ ...config, projects: config.projects.map((p) => (p.id === project.id ? { ...p, name: trimmed } : p)) })
  }
  const remove = async () => {
    if (!removing) return
    const next =
      removing.kind === 'project'
        ? {
            ...config,
            projects: config.projects.filter((p) => p.id !== removing.id),
            actions: config.actions.filter((a) => a.projectId !== removing.id)
          }
        : { ...config, actions: config.actions.filter((a) => a.id !== removing.id) }
    if (await save(next)) setRemoving(null)
  }
  const saveAction = async (draft: LauncherAction): Promise<LauncherConfigError[]> => {
    const exists = config.actions.some((a) => a.id === draft.id)
    const actions = exists ? config.actions.map((a) => (a.id === draft.id ? draft : a)) : [...config.actions, draft]
    const result = await api.launchers.save({ ...config, actions })
    if (!result.ok) return result.errors
    publishLaunchers(result.view)
    setEditing(null)
    return []
  }
  const newAction = (): LauncherAction => ({
    id: newId('a'),
    label: '',
    projectId: config.projects[0]?.id ?? '',
    showOn: 'mine',
    run: { kind: 'skill', skill: '', scope: 'project' },
    extra: '',
    workspace: 'worktree'
  })
  const projectName = (id: string) => config.projects.find((p) => p.id === id)?.name ?? '?'

  return (
    <main className="settings">
      {view.errors.length > 0 && (
        <div className="setting setting-column">
          {view.errors.map((e, i) => (
            <div key={i} className="setting-hint setting-error" role="alert">
              {errorText(e)}
            </div>
          ))}
        </div>
      )}

      <section className="group">
        <label className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('launchers.terminal')}</div>
            <div className="setting-hint">{t('launchers.terminalHint')}</div>
          </div>
          <select
            className="input select"
            value={config.terminal}
            onChange={(e) => void save({ ...config, terminal: e.target.value as LaunchersConfig['terminal'] })}
          >
            {LAUNCHER_TERMINALS.map((terminal) => (
              <option key={terminal} value={terminal}>
                {t(`launchers.terminal.${terminal}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="group">
        <div className="group-title">{t('launchers.projects')}</div>
        <div className="setting-hint launcher-intro">{t('launchers.projectsHint')}</div>
        {config.projects.map((project) => {
          const repos = Object.entries(project.repos)
          const projectSkills = skills[project.id]
          const actionCount = config.actions.filter((a) => a.projectId === project.id).length
          return (
            <div key={project.id} className="setting setting-column">
              <ProjectName project={project} onRename={(name) => renameProject(project, name)} />
              <div className="setting-hint launcher-path" title={project.path}>
                {project.path}
              </div>
              <details className="launcher-repos">
                <summary className="setting-hint">
                  {t('launchers.repos', { count: repos.length })}
                  {projectSkills ? ` · ${t('launchers.skills', { count: projectSkills.filter((s) => s.scope === 'project').length })}` : ''}
                </summary>
                <ul>
                  {repos.map(([repo, path]) => (
                    <li key={repo}>
                      <code>{repo}</code> · {path === project.path ? '.' : path.slice(project.path.length + 1)}
                    </li>
                  ))}
                </ul>
              </details>
              {removing?.kind === 'project' && removing.id === project.id ? (
                <ConfirmRow
                  message={t('launchers.removeProjectConfirm', { name: project.name })}
                  hint={actionCount > 0 ? t('launchers.actionsCount', { count: actionCount }) : undefined}
                  confirmLabel={t('launchers.remove')}
                  cancelLabel={t('launchers.cancel')}
                  danger
                  onConfirm={() => void remove()}
                  onCancel={() => setRemoving(null)}
                />
              ) : (
                <div className="launcher-buttons">
                  <button
                    className="btn btn-small"
                    disabled={busy !== null}
                    onClick={() => void projectAction(project.id, () => api.launchers.redetect(project.id))}
                  >
                    {busy === project.id ? '…' : t('launchers.redetect')}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => setRemoving({ kind: 'project', id: project.id })}>
                    {t('launchers.remove')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
        <button className="btn launcher-add" disabled={busy !== null} onClick={() => void projectAction('add', () => api.launchers.addProject())}>
          {busy === 'add' ? '…' : `+ ${t('launchers.addProject')}`}
        </button>
        {projectError && (
          <div className="setting-hint setting-error launcher-message" role="alert">
            {projectError}
          </div>
        )}
      </section>

      <section className="group">
        <div className="group-title">{t('launchers.actions')}</div>
        <div className="setting-hint launcher-intro">{t('launchers.actionsHint')}</div>
        {config.actions.length === 0 && !editing && <div className="setting-hint launcher-message">{t('launchers.noActions')}</div>}
        {config.actions.map((action) =>
          editing?.id === action.id ? (
            <ActionEditor
              key={action.id}
              initial={editing}
              projects={config.projects}
              skills={skills}
              onSave={saveAction}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={action.id} className="setting setting-column">
              <div className="setting-text">
                <div className="setting-label">{action.label}</div>
                <div className="setting-hint">
                  {t(`launchers.showOn.${action.showOn}`)} · {runSummary(action.run)} · {projectName(action.projectId)}
                </div>
              </div>
              {removing?.kind === 'action' && removing.id === action.id ? (
                <ConfirmRow
                  message={t('launchers.removeActionConfirm', { label: action.label })}
                  confirmLabel={t('launchers.remove')}
                  cancelLabel={t('launchers.cancel')}
                  danger
                  onConfirm={() => void remove()}
                  onCancel={() => setRemoving(null)}
                />
              ) : (
                <div className="launcher-buttons">
                  <button className="btn btn-small" disabled={editing !== null} onClick={() => setEditing(action)}>
                    {t('launchers.edit')}
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => setRemoving({ kind: 'action', id: action.id })}>
                    {t('launchers.remove')}
                  </button>
                </div>
              )}
            </div>
          )
        )}
        {editing && !config.actions.some((a) => a.id === editing.id) && (
          <ActionEditor initial={editing} projects={config.projects} skills={skills} onSave={saveAction} onCancel={() => setEditing(null)} />
        )}
        {!editing && (
          <button className="btn launcher-add" disabled={config.projects.length === 0} onClick={() => setEditing(newAction())}>
            + {t('launchers.newAction')}
          </button>
        )}
        {config.projects.length === 0 && <div className="setting-hint launcher-message">{t('launchers.needProject')}</div>}
        {saveErrors.length > 0 && !editing && (
          <div className="launcher-message" role="alert">
            {saveErrors.map((e, i) => (
              <div key={i} className="setting-hint setting-error">
                {errorText(e)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="group">
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('launchers.worktrees')}</div>
            <div className="setting-hint">{t('launchers.worktreesHint')}</div>
          </div>
          <button className="btn" onClick={() => void api.launchers.openWorktrees()}>
            {t('settings.openFolder')}
          </button>
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-label">{t('launchers.file')}</div>
            <div className="setting-hint">{t('launchers.fileHint')}</div>
          </div>
          <button className="btn" onClick={() => void api.launchers.openFile()}>
            {t('settings.open')}
          </button>
        </div>
      </section>
    </main>
  )
}

/** The project's name, editable in place; saved on blur or Enter. */
function ProjectName({ project, onRename }: { project: LauncherProject; onRename(name: string): void }) {
  const t = useT()
  const [name, setName] = useState(project.name)
  // Escape discards the edit: the blur it causes must not save the old closure's value.
  const discard = useRef(false)
  useEffect(() => setName(project.name), [project.name])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      e.stopPropagation()
      discard.current = true
      setName(project.name)
      e.currentTarget.blur()
    }
  }
  return (
    <input
      className="input launcher-name"
      value={name}
      maxLength={60}
      aria-label={t('launchers.projectName')}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        if (discard.current) discard.current = false
        else onRename(name)
      }}
      onKeyDown={onKeyDown}
    />
  )
}

interface EditorProps {
  initial: LauncherAction
  projects: LauncherProject[]
  skills: Record<string, SkillInfo[]>
  onSave(draft: LauncherAction): Promise<LauncherConfigError[]>
  onCancel(): void
}

/** Encodes what an action runs as one <select> value. */
const runValue = (run: LauncherAction['run']) => (run.kind === 'prompt' ? 'prompt' : run.skill ? `${run.scope}:${run.skill}` : '')

function ActionEditor({ initial, projects, skills, onSave, onCancel }: EditorProps) {
  const t = useT()
  const errorText = useErrorText()
  const [draft, setDraft] = useState(initial)
  const [prompt, setPrompt] = useState(initial.run.kind === 'prompt' ? initial.run.text : '')
  const [errors, setErrors] = useState<LauncherConfigError[]>([])
  const [saving, setSaving] = useState(false)
  const update = (patch: Partial<LauncherAction>) => setDraft((d) => ({ ...d, ...patch }))

  const list = skills[draft.projectId]
  const projectSkills = list?.filter((s) => s.scope === 'project') ?? []
  const userSkills = list?.filter((s) => s.scope === 'user') ?? []
  const skillRun = draft.run.kind === 'skill' ? draft.run : null
  const selected = skillRun ? list?.find((s) => s.name === skillRun.skill && s.scope === skillRun.scope) : undefined
  // A skill that is no longer on disk stays selectable, so editing doesn't silently change it.
  const missing = skillRun?.skill && list && !selected ? skillRun : null

  const chooseRun = (value: string) => {
    if (value === 'prompt') return update({ run: { kind: 'prompt', text: prompt } })
    const [scope, ...rest] = value.split(':')
    update({ run: { kind: 'skill', skill: rest.join(':'), scope: scope === 'user' ? 'user' : 'project' } })
  }
  const run = draft.run.kind === 'prompt' ? { kind: 'prompt' as const, text: prompt } : draft.run
  const ready = draft.label.trim() !== '' && draft.projectId !== '' && (run.kind === 'prompt' ? run.text.trim() !== '' : run.skill !== '')
  const previewPrompt = `${run.kind === 'skill' ? `/${run.skill} <PR>` : run.text}${draft.extra.trim() ? ` ${draft.extra.trim()}` : ''}`

  const submit = async () => {
    setSaving(true)
    try {
      setErrors(await onSave({ ...draft, run }))
    } finally {
      setSaving(false)
    }
  }
  const showOnOptions = LAUNCHER_SHOW_ON.map((value) => ({ value, label: t(`launchers.showOn.${value}`) }))
  const workspaceOptions = (['worktree', 'folder'] as const).map((value) => ({ value, label: t(`launchers.workspace.${value}`) }))

  return (
    <div
      className="setting setting-column launcher-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <label className="launcher-field">
        <span className="launcher-field-label">{t('launchers.field.label')}</span>
        <input
          className="input"
          value={draft.label}
          maxLength={60}
          placeholder={t('launchers.field.labelPlaceholder')}
          autoFocus
          onChange={(e) => update({ label: e.target.value })}
        />
      </label>
      {projects.length > 1 && (
        <label className="launcher-field">
          <span className="launcher-field-label">{t('launchers.field.project')}</span>
          <select className="input" value={draft.projectId} onChange={(e) => update({ projectId: e.target.value })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="launcher-field">
        <span className="launcher-field-label">{t('launchers.field.run')}</span>
        <select className="input" value={runValue(draft.run)} onChange={(e) => chooseRun(e.target.value)}>
          {draft.run.kind === 'skill' && !draft.run.skill && (
            <option value="" disabled>
              {list ? t('launchers.run.choose') : t('launchers.run.loading')}
            </option>
          )}
          {projectSkills.length > 0 && (
            <optgroup label={t('launchers.run.projectSkills')}>
              {projectSkills.map((s) => (
                <option key={`p:${s.name}`} value={`project:${s.name}`}>
                  /{s.name}
                </option>
              ))}
            </optgroup>
          )}
          {userSkills.length > 0 && (
            <optgroup label={t('launchers.run.userSkills')}>
              {userSkills.map((s) => (
                <option key={`u:${s.name}`} value={`user:${s.name}`}>
                  /{s.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('launchers.run.custom')}>
            {missing && <option value={`${missing.scope}:${missing.skill}`}>/{missing.skill}</option>}
            <option value="prompt">{t('launchers.run.prompt')}</option>
          </optgroup>
        </select>
        {draft.run.kind === 'prompt' ? (
          <>
            <input
              className="input"
              value={prompt}
              maxLength={1000}
              placeholder="/code-review {number}"
              onChange={(e) => setPrompt(e.target.value)}
            />
            <span className="setting-hint">{t('launchers.run.promptHint')}</span>
          </>
        ) : selected?.description ? (
          <span className="setting-hint launcher-description">{selected.description}</span>
        ) : list && list.length === 0 ? (
          <span className="setting-hint">{t('launchers.run.noSkills')}</span>
        ) : null}
      </label>
      <label className="launcher-field">
        <span className="launcher-field-label">{t('launchers.field.extra')}</span>
        <input
          className="input"
          value={draft.extra}
          maxLength={500}
          placeholder={t('launchers.field.extraPlaceholder')}
          onChange={(e) => update({ extra: e.target.value })}
        />
      </label>
      <div className="launcher-field">
        <span className="launcher-field-label">{t('launchers.field.showOn')}</span>
        <Segmented<LauncherShowOn>
          options={showOnOptions}
          value={draft.showOn}
          onChange={(showOn) => update({ showOn })}
          label={t('launchers.field.showOn')}
        />
      </div>
      <div className="launcher-field">
        <span className="launcher-field-label">{t('launchers.field.workspace')}</span>
        <Segmented
          options={workspaceOptions}
          value={draft.workspace}
          onChange={(workspace) => update({ workspace })}
          label={t('launchers.field.workspace')}
        />
        <span className="setting-hint">
          {t(draft.workspace === 'worktree' ? 'launchers.workspace.worktreeHint' : 'launchers.workspace.folderHint')}
        </span>
      </div>
      {ready && <div className="launcher-preview">{t('launchers.preview', { command: `claude "${previewPrompt}"` })}</div>}
      {errors.map((e, i) => (
        <div key={i} className="setting-hint setting-error" role="alert">
          {errorText(e)}
        </div>
      ))}
      <div className="launcher-buttons">
        <button className="btn btn-primary btn-small" disabled={!ready || saving} onClick={() => void submit()}>
          {saving ? '…' : t('launchers.save')}
        </button>
        <button className="btn btn-small" onClick={onCancel}>
          {t('launchers.cancel')}
        </button>
      </div>
    </div>
  )
}
