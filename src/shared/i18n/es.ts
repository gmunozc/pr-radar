import type { MessageKey } from './en'

/** Spanish strings. Typed against en.ts, so a missing key fails to compile. */
export const es: Record<MessageKey, string> = {
  // Header
  'header.loading': 'Cargando…',
  'header.updated': 'Actualizado {time}',
  'header.searching': 'Buscando PRs…',
  'header.nothingPending': 'Nada pendiente',
  'header.pending.one': '{count} review pendiente',
  'header.pending.other': '{count} reviews pendientes',
  'header.waiting': '{count} esperando review',
  'header.noOpenPrs': 'Sin PRs abiertos',
  'header.openPrs.one': '{count} PR abierto',
  'header.openPrs.other': '{count} PRs abiertos',
  'header.settings': 'Ajustes',
  'header.back': 'Volver',
  'header.refresh': 'Actualizar ahora',

  // Errors
  'error.network': 'Sin conexión con GitHub.',
  'error.rate_limited': 'Límite de peticiones de GitHub alcanzado. Se reintentará a las {time}.',
  'error.rate_limited_soon': 'Límite de peticiones de GitHub alcanzado. Se reintentará en breve.',
  'error.unauthorized': 'GitHub rechazó la sesión.',
  'error.unknown': 'Error de GitHub: {detail}',

  // Warnings
  'warning.saml': 'Algunas organizaciones requieren autorizar SAML SSO para esta app; sus PRs no aparecen.',
  'warning.partial': 'GitHub devolvió resultados parciales: {detail}',
  'warning.truncated_requested': 'Mostrando {shown} de {total} PRs por revisar.',
  'warning.truncated_mine': 'Mostrando {shown} de {total} de tus PRs.',
  'warning.refresh_unsupported':
    'GitHub no permite renovar la sesión de esta OAuth App: caducará en 8 h. En la OAuth App, desmarca "Expire user authorization tokens" y vuelve a conectar.',

  // Tabs
  'tabs.review': 'Por revisar',
  'tabs.mine': 'Mis PRs',

  // Review requests list
  'list.emptyTitle': 'Nada pendiente de revisar',
  'list.emptySub': 'Te avisaremos cuando alguien te pida una review.',
  'list.orgHintTitle': '¿Esperabas ver PRs de tu organización?',
  'list.orgHint': 'Puede que la org restrinja las OAuth Apps.',
  'list.orgAccess': 'Dar acceso a la org',
  'list.viewAll': 'Ver todo en GitHub',
  'list.dismissed.one': '{count} descartado',
  'list.dismissed.other': '{count} descartados',
  'list.restore': 'Restaurar',

  // A review request row
  'pr.direct': 'Directo',
  'pr.team': 'Equipo',
  'pr.teamNamed': 'Equipo · {slug}',
  'pr.draft': 'Draft',
  'pr.dismiss': 'Descartar',
  'pr.dismissHint': 'Descartar (vuelve a aparecer si te piden review de nuevo)',

  // My PRs
  'mine.emptyTitle': 'No tienes PRs abiertos',
  'mine.emptySub': 'Aquí verás tus PRs y quién falta por revisarlos.',
  'mine.viewAll': 'Ver mis PRs en GitHub',
  'status.waiting': 'Esperando review',
  'status.approved': 'Aprobado',
  'status.changes_requested': 'Cambios solicitados',
  'status.no_reviewers': 'Sin reviewers',
  'reviewer.approved': '@{login}: aprobó',
  'reviewer.changes': '@{login}: pidió cambios',
  'reviewer.pending': '{name}: pendiente',
  'reviewer.team': 'equipo',

  // Login
  'login.tagline': 'Conecta tu cuenta de GitHub y te avisaremos cada vez que te pidan revisar un pull request.',
  'login.connect': 'Conectar con GitHub',
  'login.connecting': 'Conectando…',
  'login.changeClientId': 'Cambiar Client ID',
  'login.copyDiagnostics': 'Copiar diagnóstico',
  'login.quit': 'Salir',
  'login.enterCode': 'Introduce este código en GitHub para autorizar la app:',
  'login.copied': 'Copiado al portapapeles',
  'login.open': 'Abrir {host}',
  'login.waiting': 'Esperando autorización…',
  'login.expiresIn': 'El código expira en {time}',
  'login.cancel': 'Cancelar',
  'setup.intro': 'Para conectar con GitHub necesitas el **Client ID** de una OAuth App con **Device Flow** activado.',
  'setup.createApp': 'Crea una OAuth App',
  'setup.createAppRest': '(Homepage y Callback: `http://localhost`).',
  'setup.enableDeviceFlow': 'Marca **Enable Device Flow** y guarda.',
  'setup.paste': 'Copia el Client ID y pégalo aquí:',
  'setup.save': 'Guardar',

  // Why the user is signed out
  'notice.session_expired': 'Tu sesión de GitHub caducó. Vuelve a conectar; tus PRs descartados se conservan.',
  'notice.refresh_unsupported':
    'GitHub no permitió renovar la sesión. En tu OAuth App, desmarca "Expire user authorization tokens" y vuelve a conectar.',
  'notice.keychain_denied':
    'No se pudo leer la sesión guardada (acceso al Llavero denegado). Vuelve a conectar y pulsa "Permitir siempre".',

  // Login errors
  'authError.device_flow_disabled': 'La OAuth App no tiene activado "Enable Device Flow".',
  'authError.invalid_client': 'Client ID no válido: no existe ninguna OAuth App con ese ID.',
  'authError.expired_token': 'El código expiró. Vuelve a intentarlo.',
  'authError.access_denied': 'Autorización denegada en GitHub.',
  'authError.network': 'No se pudo contactar con GitHub.',
  'authError.http': 'GitHub respondió con un error ({detail}).',
  'authError.missing_client_id': 'Falta el Client ID de la OAuth App.',
  'authError.unknown': 'Error de GitHub: {detail}',

  // Settings
  'settings.whatToReview': 'Qué revisar',
  'settings.includeTeams': 'Incluir solicitudes a mis equipos',
  'settings.includeTeamsHint': 'Si está desactivado, solo las reviews pedidas a ti directamente.',
  'settings.showDrafts': 'Mostrar PRs en draft',
  'settings.alerts': 'Avisos',
  'settings.notifications': 'Notificaciones',
  'settings.notificationsHint': 'Aviso nativo cuando te asignen una review nueva.',
  'settings.interval': 'Revisar cada',
  'settings.intervalHint': 'Segundos entre consultas (mínimo {min}).',
  'settings.test': 'Probar notificación',
  'settings.testHint': 'En macOS, la primera vez pedirá permiso.',
  'settings.testSent':
    'Enviada al Centro de notificaciones. Si no apareció el aviso, desactiva Concentración o activa los avisos de PR Radar en',
  'settings.notificationSettings': 'Ajustes de notificaciones',
  'settings.testFailed': 'No se pudo mostrar: {error}',
  'settings.openNotificationSettings': 'Abrir ajustes de notificaciones',
  'settings.testButton': 'Probar',
  'settings.sending': 'Enviando…',
  'settings.general': 'General',
  'settings.openAtLogin': 'Abrir al iniciar sesión',
  'settings.language': 'Idioma',
  'settings.languageSystem': 'Automático',
  'settings.orgAccess': 'Acceso a organizaciones',
  'settings.orgAccessHint': 'Si faltan PRs de una org, concede o solicita acceso a la app.',
  'settings.open': 'Abrir',
  'settings.account': 'Cuenta de GitHub',
  'settings.logout': 'Cerrar sesión',
  'settings.quitApp': 'Salir de PR Radar',
  'settings.quit': 'Salir',
  'settings.help': 'Ayuda',
  'settings.diagnostics': 'Diagnóstico',
  'settings.diagnosticsHint': 'Copia un informe sin tokens para reportar un problema · versión {version}.',
  'settings.copy': 'Copiar',
  'settings.copied': 'Copiado',
  'settings.logs': 'Registro de actividad',
  'settings.openFolder': 'Abrir carpeta',
  'notify.unsupported': 'Este sistema no soporta notificaciones.',

  // Native notifications
  'notif.reviewRequested': 'Nueva review solicitada',
  'notif.reviewRequestedTeam': 'Review solicitada a tu equipo {slug}',
  'notif.reviewRequestedTeamUnnamed': 'Review solicitada a tu equipo',
  'notif.summary.one': 'Tienes {count} PR pendiente de revisar',
  'notif.summary.other': 'Tienes {count} PRs pendientes de revisar',
  'notif.grouped': '{count} nuevas reviews solicitadas',
  'notif.sessionExpired': 'Tu sesión de GitHub expiró. Vuelve a conectar tu cuenta.',
  'notif.test': 'Las notificaciones funcionan correctamente.',

  // Menu bar icon
  'tray.open': 'Abrir PR Radar',
  'tray.openCount': 'Abrir PR Radar ({count})',
  'tray.refresh': 'Actualizar ahora',
  'tray.openAtLogin': 'Abrir al iniciar sesión',
  'tray.logout': 'Cerrar sesión de GitHub',
  'tray.quit': 'Salir',
  'tray.tooltipSignedOut': 'PR Radar — sin conectar',
  'tray.tooltipPending.one': 'PR Radar — {count} PR pendiente',
  'tray.tooltipPending.other': 'PR Radar — {count} PRs pendientes',
  'tray.tooltipNone': 'PR Radar — nada pendiente',
  'tray.statusOffline': 'Sin conexión — reintentando',
  'tray.statusRateLimited': 'Límite de GitHub — reintento a las {time}',
  'tray.statusRateLimitedSoon': 'Límite de GitHub — reintento en breve',
  'tray.statusError': 'Error de GitHub — reintentando',
  'tray.statusSessionExpired': 'Sesión caducada — Volver a conectar…'
}
