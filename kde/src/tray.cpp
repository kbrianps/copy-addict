#include "tray.h"
#include "app.h"
#include "settings.h"

#include <KLocalizedString>
#include <KStatusNotifierItem>

#include <QMenu>

static const QString ICON = QStringLiteral("edit-paste-symbolic");
static const QString ICON_INCOGNITO = QStringLiteral("view-conceal-symbolic");
static const QString ICON_COPIED = QStringLiteral("object-select-symbolic");
static const int FLASH_MS = 650;

Tray::Tray(App *app)
    : QObject(app)
    , m_app(app)
{
    m_sni = new KStatusNotifierItem(QStringLiteral("copy-addict"), this);
    m_sni->setCategory(KStatusNotifierItem::ApplicationStatus);
    m_sni->setStatus(KStatusNotifierItem::Active);
    m_sni->setTitle(QStringLiteral("copy-addict"));
    m_sni->setStandardActionsEnabled(false);
    // Left click opens the bar, middle click toggles incognito.
    connect(m_sni, &KStatusNotifierItem::activateRequested, app, [app](bool, const QPoint &) { app->toggle(); });
    connect(m_sni, &KStatusNotifierItem::secondaryActivateRequested, app, [app](const QPoint &) { app->toggleIncognito(); });

    auto *menu = new QMenu;
    m_openAction = menu->addAction(QIcon::fromTheme(ICON), i18n("Open clipboard history"), app, &App::open);
    m_incognitoAction = menu->addAction(i18n("Incognito mode"), app, &App::toggleIncognito);
    m_incognitoAction->setCheckable(true);
    menu->addSeparator();
    menu->addAction(QIcon::fromTheme(QStringLiteral("edit-clear-all-symbolic")), i18n("Clear history…"), app, &App::openClearConfirm);
    menu->addAction(QIcon::fromTheme(QStringLiteral("preferences-system-symbolic")), i18n("Settings"), app, &App::openSettings);
    menu->addSeparator();
    menu->addAction(QIcon::fromTheme(QStringLiteral("application-exit-symbolic")), i18n("Quit"), app, &App::quit);
    m_sni->setContextMenu(menu);

    m_flashTimer.setSingleShot(true);
    m_flashTimer.setInterval(FLASH_MS);
    connect(&m_flashTimer, &QTimer::timeout, this, &Tray::sync);
    sync();
}

Tray::~Tray()
{
    delete m_sni;
}

void Tray::sync()
{
    if (!m_sni)
        return;
    const bool inc = m_app->settings()->boolValue(QStringLiteral("incognito"));
    if (!m_flashTimer.isActive())
        m_sni->setIconByName(inc ? ICON_INCOGNITO : ICON);
    m_sni->setToolTip(inc ? ICON_INCOGNITO : ICON, QStringLiteral("copy-addict"),
                      inc ? i18n("Incognito: not saving") : i18n("Clipboard history"));
    m_incognitoAction->setChecked(inc);
    const QString key = m_app->shortcutLabel();
    m_openAction->setText(key.isEmpty() ? i18n("Open clipboard history") : i18n("Open clipboard history (%1)", key));
}

void Tray::flash()
{
    if (!m_sni || m_app->settings()->boolValue(QStringLiteral("incognito")))
        return;
    m_sni->setIconByName(ICON_COPIED);
    m_flashTimer.start();
}
