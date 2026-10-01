/**
 * English strings: the canonical dictionary. Every key must also exist in es.ts (enforced by
 * its type). `{name}` is a parameter; keys ending in `.one` / `.other` are plural forms picked
 * with Intl.PluralRules from the `count` parameter. `**bold**` and `` `code` `` are rendered
 * by the panel's <Rich> component.
 */
export const en = {
  // Shown if the panel itself crashes
  'crash.title': 'Something went wrong showing the panel.',
  'crash.reload': 'Reload',

  // Header
  'header.loading': 'Loading…',
  'header.updated': 'Updated {time}',
  'header.searching': 'Looking for PRs…',
  'header.nothingPending': 'Nothing to review',
  'header.pending.one': '{count} review pending',
  'header.pending.other': '{count} reviews pending',
  'header.waiting': '{count} waiting for review',
  'header.noOpenPrs': 'No open PRs',
  'header.openPrs.one': '{count} open PR',
  'header.openPrs.other': '{count} open PRs',
  'header.readyToMerge.one': '{count} ready to merge',
  'header.readyToMerge.other': '{count} ready to merge',
  'header.settings': 'Settings',
  'header.back': 'Back',
  'header.refresh': 'Refresh now',

  // Errors shown in the panel (AppState.error.code)
  'error.network': 'No connection to GitHub.',
  'error.rate_limited': 'GitHub rate limit reached. Retrying at {time}.',
  'error.rate_limited_soon': 'GitHub rate limit reached. Retrying soon.',
  'error.unauthorized': 'GitHub rejected the session.',
  'error.unknown': 'GitHub error: {detail}',

  // Warnings (AppState.warnings[].code)
  'warning.saml': 'Some organizations require SAML SSO authorization for this app; their PRs are hidden.',
  'warning.partial': 'GitHub returned partial results: {detail}',
  'warning.truncated_requested': 'Showing {shown} of {total} PRs to review.',
  'warning.truncated_mine': 'Showing {shown} of {total} of your PRs.',
  'warning.missing_permission': 'PR Radar has no permission to read {field} in some repositories.',
  'permission.checks': 'CI checks',
  'permission.merge': 'merge status',
  'warning.refresh_unsupported':
    'GitHub does not allow renewing this OAuth App session, so it will expire in 8 h. In the OAuth App, untick "Expire user authorization tokens" and reconnect.',

  // Tabs
  'tabs.review': 'To review',
  'tabs.mine': 'My PRs',

  // Review requests list
  'list.emptyTitle': 'Nothing to review',
  'list.emptySub': "We'll let you know when someone requests your review.",
  'list.orgHintTitle': 'Expecting PRs from your organization?',
  'list.orgHint': 'The organization may restrict OAuth Apps.',
  'list.orgAccess': 'Grant access to the org',
  'list.viewAll': 'View all on GitHub',
  'list.dismissed.one': '{count} dismissed',
  'list.dismissed.other': '{count} dismissed',
  'list.restore': 'Restore',

  // A review request row
  'pr.direct': 'Direct',
  'pr.team': 'Team',
  'pr.teamNamed': 'Team · {slug}',
  'pr.draft': 'Draft',
  'pr.newCommits': 'New commits',
  'pr.newCommitsHint': 'The author pushed after your review on {date}',
  'pr.dismiss': 'Dismiss',
  'pr.dismissHint': 'Dismiss (it comes back if your review is requested again)',

  // My PRs
  'mine.emptyTitle': 'No open PRs',
  'mine.emptySub': 'Your PRs and who still has to review them will show up here.',
  'mine.viewAll': 'View my PRs on GitHub',
  'status.waiting': 'Waiting for review',
  'status.approved': 'Approved',
  'status.changes_requested': 'Changes requested',
  'status.no_reviewers': 'No reviewers',
  'status.ready': 'Ready to merge',
  'blocker.conflicts': 'Conflicts',
  'blocker.conflictsHint': 'Merge conflicts with the base branch',
  'blocker.behind': 'Out of date',
  'blocker.behindHint': 'The base branch has new commits: update this branch before merging',
  'blocker.blocked': 'Blocked',
  'blocker.blockedHint': 'Branch protection does not allow merging yet',
  'ci.success': 'Checks passed',
  'ci.failure': 'Checks failing',
  'ci.pending': 'Checks running',
  'ci.unknown': 'Checks unavailable',
  'reviewer.approved': '@{login}: approved',
  'reviewer.changes': '@{login}: requested changes',
  'reviewer.pending': '{name}: pending',
  'reviewer.team': 'team',

  // Login
  'login.tagline': "Connect your GitHub account and we'll let you know whenever someone asks you to review a pull request.",
  'login.connect': 'Connect with GitHub',
  'login.connecting': 'Connecting…',
  'login.changeClientId': 'Change Client ID',
  'login.copyDiagnostics': 'Copy diagnostics',
  'login.quit': 'Quit',
  'login.enterCode': 'Enter this code on GitHub to authorize the app:',
  'login.copied': 'Copied to clipboard',
  'login.open': 'Open {host}',
  'login.waiting': 'Waiting for authorization…',
  'login.expiresIn': 'The code expires in {time}',
  'login.cancel': 'Cancel',
  'setup.intro': 'To connect to GitHub you need the **Client ID** of an OAuth App with **Device Flow** enabled.',
  'setup.createApp': 'Create an OAuth App',
  'setup.createAppRest': '(Homepage and Callback: `http://localhost`).',
  'setup.enableDeviceFlow': 'Tick **Enable Device Flow** and save.',
  'setup.paste': 'Copy the Client ID and paste it here:',
  'setup.save': 'Save',

  // Why the user is signed out (AppState.authNotice)
  'notice.session_expired': 'Your GitHub session expired. Reconnect; your dismissed PRs are kept.',
  'notice.refresh_unsupported':
    'GitHub did not allow renewing the session. In your OAuth App, untick "Expire user authorization tokens" and reconnect.',
  'notice.keychain_denied': 'The saved session could not be read (Keychain access denied). Reconnect and choose "Always Allow".',

  // Login errors (AuthStatus error code)
  'authError.device_flow_disabled': 'The OAuth App does not have "Enable Device Flow" turned on.',
  'authError.invalid_client': 'Invalid Client ID: there is no OAuth App with that ID.',
  'authError.expired_token': 'The code expired. Try again.',
  'authError.access_denied': 'Authorization was denied on GitHub.',
  'authError.network': 'Could not reach GitHub.',
  'authError.http': 'GitHub answered with an error ({detail}).',
  'authError.missing_client_id': 'The OAuth App Client ID is missing.',
  'authError.unknown': 'GitHub error: {detail}',

  // Settings
  'settings.whatToReview': 'What to review',
  'settings.includeTeams': 'Include requests to my teams',
  'settings.includeTeamsHint': 'When off, only reviews requested from you directly.',
  'settings.showDrafts': 'Show draft PRs',
  'settings.alerts': 'Alerts',
  'settings.notifications': 'Notifications',
  'settings.notificationsHint': 'A native alert when a new review is requested.',
  'settings.notifyMyPrs': 'Updates on my PRs',
  'settings.notifyMyPrsHint': 'When your PRs get approved, changes requested, or become ready to merge.',
  'settings.interval': 'Check every',
  'settings.intervalHint': 'Seconds between checks (minimum {min}).',
  'settings.test': 'Test notification',
  'settings.testHint': 'On macOS, it asks for permission the first time.',
  'settings.testSent':
    'Sent to Notification Center. If no alert appeared, turn off Focus or enable alerts for PR Radar in',
  'settings.notificationSettings': 'Notification settings',
  'settings.testFailed': 'Could not show it: {error}',
  'settings.openNotificationSettings': 'Open notification settings',
  'settings.testButton': 'Test',
  'settings.sending': 'Sending…',
  'settings.general': 'General',
  'settings.openAtLogin': 'Open at login',
  'settings.language': 'Language',
  'settings.languageSystem': 'System',
  'settings.orgAccess': 'Organization access',
  'settings.orgAccessHint': 'If PRs from an organization are missing, grant or request access for the app.',
  'settings.open': 'Open',
  'settings.account': 'GitHub account',
  'settings.logout': 'Sign out',
  'settings.quitApp': 'Quit PR Radar',
  'settings.quit': 'Quit',
  'settings.help': 'Help',
  'settings.diagnostics': 'Diagnostics',
  'settings.diagnosticsHint': 'Copies a report without tokens to report a problem · version {version}.',
  'settings.copy': 'Copy',
  'settings.copied': 'Copied',
  'settings.logs': 'Activity log',
  'settings.openFolder': 'Open folder',
  'notify.unsupported': 'This system does not support notifications.',

  // Native notifications
  'notif.reviewRequested': 'New review requested',
  'notif.reviewRequestedTeam': 'Review requested from your team {slug}',
  'notif.reviewRequestedTeamUnnamed': 'Review requested from your team',
  'notif.summary.one': 'You have {count} PR to review',
  'notif.summary.other': 'You have {count} PRs to review',
  'notif.grouped': '{count} new review requests',
  'notif.reReviewRequested': 'Your review is requested again',
  'notif.changesRequested': 'Changes requested on your PR',
  'notif.approved': 'Your PR was approved',
  'notif.readyToMerge': 'Ready to merge',
  'notif.myPrsGrouped.one': '{count} update on your PRs',
  'notif.myPrsGrouped.other': '{count} updates on your PRs',
  'notif.sessionExpired': 'Your GitHub session expired. Reconnect your account.',
  'notif.test': 'Notifications are working.',

  // Menu bar icon
  'tray.open': 'Open PR Radar',
  'tray.openCount': 'Open PR Radar ({count})',
  'tray.refresh': 'Refresh now',
  'tray.openAtLogin': 'Open at login',
  'tray.logout': 'Sign out of GitHub',
  'tray.quit': 'Quit',
  'tray.tooltipSignedOut': 'PR Radar — not connected',
  'tray.tooltipPending.one': 'PR Radar — {count} PR to review',
  'tray.tooltipPending.other': 'PR Radar — {count} PRs to review',
  'tray.tooltipNone': 'PR Radar — nothing to review',
  'tray.statusOffline': 'No connection — retrying',
  'tray.statusRateLimited': 'GitHub rate limit — retrying at {time}',
  'tray.statusRateLimitedSoon': 'GitHub rate limit — retrying soon',
  'tray.statusError': 'GitHub error — retrying',
  'tray.statusSessionExpired': 'Session expired — Reconnect…'
} as const

export type MessageKey = keyof typeof en
