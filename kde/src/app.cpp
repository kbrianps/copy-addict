#include "app.h"
#include "capture.h"
#include "filtermodel.h"
#include "highlighter.h"
#include "iconprovider.h"
#include "kwinbridge.h"
#include "linkpreview.h"
#include "paster.h"
#include "settings.h"
#include "store.h"
#include "tray.h"
#include "util.h"

#include <KGlobalAccel>
#include <KLocalizedQmlContext>
#include <KLocalizedString>
#include <LayerShellQt/Window>

#include <QAction>
#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QQmlApplicationEngine>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQuickWindow>
#include <QRegularExpression>
#include <QUrl>

#include <sys/stat.h>

static const int PASTE_DELAY_MS = 160;
static const QString COMPONENT = QStringLiteral("copy-addict");

App::App(QObject *parent)
    : QObject(parent)
    , m_settings(new Settings(this))
    , m_store(new Store(m_settings, this))
    , m_filter(new FilterModel(this))
    , m_highlighter(new Highlighter(this))
    , m_links(new LinkPreview(m_store, this))
    , m_kwin(new KWinBridge(this))
    , m_capture(new Capture(m_store, m_settings, m_highlighter, m_links, m_kwin, this))
{
    m_filter->setSourceModel(m_store);
    m_store->setHighlighter(m_highlighter);
    applyNewSessionPolicy();

    connect(m_settings, &Settings::keyChanged, this, &App::onSettingChanged);
    connect(m_capture, &Capture::newItem, this, [this]() {
        if (m_tray)
            m_tray->flash();
    });
    // Code detection needs highlight.js: re-check text items once it is loaded.
    connect(m_highlighter, &Highlighter::loaded, this, [this]() {
        if (m_highlighter->isLoaded())
            m_capture->redetectAll();
        m_store->warmHighlights();
    });
    // "Forget items after N minutes" also applies while nothing new is copied.
    m_trimTimer.setInterval(60000);
    connect(&m_trimTimer, &QTimer::timeout, this, [this]() {
        if (m_store->trim())
            m_store->save();
    });
    if (m_settings->intValue(QStringLiteral("historyMinutes")) > 0)
        m_trimTimer.start();
    // Link previews that never finished (offline, app closed early).
    for (const Item &i : m_store->items()) {
        if (i.type == QLatin1String("link") && !i.meta.contains(QStringLiteral("link")))
            QTimer::singleShot(3000, this, [this, id = i.id]() { m_links->ensure(id); });
    }
}

App::~App()
{
    m_store->saveNow();
    delete m_engine;
}

bool App::start(bool preview)
{
    auto bus = QDBusConnection::sessionBus();
    if (!bus.registerService(QStringLiteral("org.kbrianps.CopyAddict")))
        return false;
    bus.registerObject(QStringLiteral("/CopyAddict"), this, QDBusConnection::ExportScriptableSlots);
    bus.registerObject(QStringLiteral("/KWinBridge"), m_kwin, QDBusConnection::ExportScriptableSlots);
    m_kwin->start();
    m_paster = new Paster(this);
    setupShortcuts();
    syncTray();
    setupBar();
    if (preview)
        showPreview(true);
    qInfo("copy-addict %s: %d items", COPY_ADDICT_VERSION, m_store->count());
    return true;
}

// ---------- shortcuts ----------
void App::setupShortcuts()
{
    m_openAction = new QAction(i18n("Open the clipboard history"), this);
    m_openAction->setObjectName(QStringLiteral("open"));
    m_openAction->setProperty("componentName", COMPONENT);
    m_openAction->setProperty("componentDisplayName", QStringLiteral("copy-addict"));
    const QList<QKeySequence> openKeys{QKeySequence(Qt::META | Qt::Key_V)};
    KGlobalAccel::self()->setDefaultShortcut(m_openAction, openKeys);
    KGlobalAccel::self()->setShortcut(m_openAction, openKeys);
    connect(m_openAction, &QAction::triggered, this, &App::toggle);

    m_incognitoAction = new QAction(i18n("Toggle incognito mode"), this);
    m_incognitoAction->setObjectName(QStringLiteral("incognito"));
    m_incognitoAction->setProperty("componentName", COMPONENT);
    m_incognitoAction->setProperty("componentDisplayName", QStringLiteral("copy-addict"));
    const QList<QKeySequence> incKeys{QKeySequence(Qt::META | Qt::CTRL | Qt::SHIFT | Qt::Key_V)};
    KGlobalAccel::self()->setDefaultShortcut(m_incognitoAction, incKeys);
    KGlobalAccel::self()->setShortcut(m_incognitoAction, incKeys);
    connect(m_incognitoAction, &QAction::triggered, this, &App::toggleIncognito);

    connect(KGlobalAccel::self(), &KGlobalAccel::globalShortcutChanged, this, [this](QAction *, const QKeySequence &) {
        Q_EMIT shortcutsChanged();
        if (m_tray)
            m_tray->sync();
    });
}

static QString keyLabel(QAction *a)
{
    if (!a)
        return {};
    const QList<QKeySequence> keys = KGlobalAccel::self()->shortcut(a);
    return keys.isEmpty() ? QString() : keys.first().toString(QKeySequence::NativeText);
}

QString App::shortcutLabel() const
{
    return keyLabel(m_openAction);
}

QString App::incognitoShortcutLabel() const
{
    return keyLabel(m_incognitoAction);
}

void App::configureShortcuts()
{
    if (m_settingsWindow)
        m_settingsWindow->close();
    QProcess::startDetached(QStringLiteral("systemsettings"), {QStringLiteral("kcm_keys"), QStringLiteral("--args"), COMPONENT});
}

// ---------- the bar ----------
void App::setupBar()
{
    m_engine = new QQmlApplicationEngine(this);
    m_engine->rootContext()->setContextObject(new KLocalizedQmlContext(m_engine));
    m_engine->addImageProvider(QStringLiteral("icon"), new IconProvider);
    m_engine->rootContext()->setContextProperty(QStringLiteral("app"), this);
    m_engine->rootContext()->setContextProperty(QStringLiteral("settings"), m_settings);
    m_engine->rootContext()->setContextProperty(QStringLiteral("history"), m_filter);
    m_engine->rootContext()->setContextProperty(QStringLiteral("store"), m_store);
    m_engine->loadFromModule(QStringLiteral("CopyAddict"), QStringLiteral("Bar"));
    if (m_engine->rootObjects().isEmpty()) {
        qCritical("copy-addict: could not load the bar");
        return;
    }
    m_bar = qobject_cast<QQuickWindow *>(m_engine->rootObjects().first());
    if (!m_bar)
        return;
    // A layer-shell surface over everything, filling the work area (panels stay visible).
    auto *ls = LayerShellQt::Window::get(m_bar);
    ls->setLayer(LayerShellQt::Window::LayerOverlay);
    ls->setAnchors(LayerShellQt::Window::Anchors(LayerShellQt::Window::AnchorTop | LayerShellQt::Window::AnchorBottom
                                                 | LayerShellQt::Window::AnchorLeft | LayerShellQt::Window::AnchorRight));
    ls->setExclusiveZone(0);
    ls->setScope(QStringLiteral("copy-addict"));
    ls->setKeyboardInteractivity(LayerShellQt::Window::KeyboardInteractivityExclusive);
    ls->setWantsToBeOnActiveScreen(true);   // the monitor KWin considers active
    ls->setCloseOnDismissed(false);
}

void App::showBar(bool preview)
{
    if (!m_bar)
        return;
    if (m_open && m_previewMode == preview)
        return;
    if (m_open)
        m_bar->hide();
    m_previewMode = preview;
    LayerShellQt::Window::get(m_bar)->setKeyboardInteractivity(preview ? LayerShellQt::Window::KeyboardInteractivityNone
                                                                       : LayerShellQt::Window::KeyboardInteractivityExclusive);
    m_open = true;
    Q_EMIT aboutToOpen();
    Q_EMIT openChanged();
    m_bar->show();
    if (!preview)
        m_bar->requestActivate();
}

void App::toggle()
{
    if (m_open && !m_previewMode)
        close();
    else
        open();
}

void App::open()
{
    showBar(false);
}

void App::showPreview(bool on)
{
    if (on)
        showBar(true);
    else if (m_previewMode)
        close();
}

void App::close()
{
    if (!m_open)
        return;
    m_open = false;
    m_previewMode = false;
    if (m_bar) {
        m_bar->hide();
        m_bar->releaseResources();   // drop the textures and caches the bar no longer shows
    }
    Q_EMIT openChanged();
}

void App::openClearConfirm()
{
    open();
    Q_EMIT clearConfirmRequested();
}

void App::openSettings()
{
    close();
    if (!m_settingsWindow) {
        QQmlComponent component(m_engine, QStringLiteral("CopyAddict"), QStringLiteral("SettingsWindow"));
        QObject *obj = component.create(m_engine->rootContext());
        if (!obj) {
            qWarning("copy-addict: settings window: %s", qPrintable(component.errorString()));
            return;
        }
        m_settingsWindow = qobject_cast<QQuickWindow *>(obj);
    }
    if (m_settingsWindow) {
        m_settingsWindow->show();
        m_settingsWindow->raise();
        m_settingsWindow->requestActivate();
    }
}

void App::quit()
{
    close();
    QCoreApplication::quit();
}

int App::itemCount() const
{
    return m_store->count();
}

void App::pasteItem(int position)
{
    if (position < 0 || position >= m_store->count())
        return;
    activate(m_store->items().at(position).id, QStringLiteral("paste"));
}

// ---------- settings and session ----------
void App::onSettingChanged(const QString &key)
{
    if (key == QLatin1String("historyLength") || key == QLatin1String("historyMinutes")) {
        if (m_store->trim())
            m_store->save();
        if (m_settings->intValue(QStringLiteral("historyMinutes")) > 0)
            m_trimTimer.start();
        else
            m_trimTimer.stop();
    } else if (key == QLatin1String("protectPinned") || key == QLatin1String("protectTagged")) {
        m_store->refreshAll();
    } else if (key == QLatin1String("showTrayIcon") || key == QLatin1String("incognito")) {
        syncTray();
    }
}

void App::syncTray()
{
    const bool want = m_settings->boolValue(QStringLiteral("showTrayIcon"));
    if (want && !m_tray)
        m_tray = new Tray(this);
    else if (!want && m_tray) {
        delete m_tray;
        m_tray = nullptr;
    }
    if (m_tray)
        m_tray->sync();
}

// Copyous "clipboard-history": what to keep when a new login starts.
void App::applyNewSessionPolicy()
{
    QFile boot(QStringLiteral("/proc/sys/kernel/random/boot_id"));
    QString id = boot.open(QIODevice::ReadOnly) ? QString::fromLatin1(boot.readAll()).trimmed() : QString();
    // The Wayland socket is created anew at every login; restarts of this app keep it.
    const QString runtime = qEnvironmentVariable("XDG_RUNTIME_DIR");
    const QString socket = runtime + QLatin1Char('/') + qEnvironmentVariable("WAYLAND_DISPLAY", QStringLiteral("wayland-0"));
    struct stat st;
    if (::stat(QFile::encodeName(socket).constData(), &st) == 0)
        id += QStringLiteral(":%1:%2").arg(st.st_ino).arg(st.st_ctime);
    const QString sessionFile = Util::dataDir() + QStringLiteral("/session-kde");
    QFile f(sessionFile);
    QString last;
    if (f.open(QIODevice::ReadOnly)) {
        last = QString::fromUtf8(f.readAll()).trimmed();
        f.close();
    }
    Util::writePrivateFile(sessionFile, id.toUtf8());
    if (last.isEmpty() || last == id)
        return;
    const QString policy = m_settings->stringValue(QStringLiteral("onNewSession"));
    if (policy == QLatin1String("clear"))
        m_store->clear(true);
    else if (policy == QLatin1String("keep-pinned-and-tagged"))
        m_store->clear(false);
}

void App::toggleIncognito()
{
    const bool on = !m_settings->boolValue(QStringLiteral("incognito"));
    m_settings->set(QStringLiteral("incognito"), on);
    auto msg = QDBusMessage::createMethodCall(QStringLiteral("org.kde.plasmashell"), QStringLiteral("/org/kde/osdService"),
                                              QStringLiteral("org.kde.osdService"), QStringLiteral("showText"));
    msg << (on ? QStringLiteral("view-conceal-symbolic") : QStringLiteral("view-reveal-symbolic"))
        << (on ? i18n("copy-addict: incognito mode on") : i18n("copy-addict: incognito mode off"));
    QDBusConnection::sessionBus().asyncCall(msg);
}

// ---------- info for QML ----------
QVariantList App::tags() const
{
    QVariantList out;
    for (const Tag &t : Store::tags())
        out << QVariantMap{{QStringLiteral("id"), t.id}, {QStringLiteral("name"), t.name}, {QStringLiteral("color"), t.color}};
    return out;
}

QStringList App::typeOrder() const
{
    return Store::typeOrder();
}

QString App::version() const
{
    return QStringLiteral(COPY_ADDICT_VERSION);
}

QString App::typeName(const QString &type) const
{
    return Store::typeName(type);
}

QString App::typeIcon(const QString &type) const
{
    return Store::typeIcon(type);
}

QString App::tagName(const QString &id) const
{
    const Tag *t = Store::tagById(id);
    return t ? t->name : QString();
}

QString App::tagColor(const QString &id) const
{
    const Tag *t = Store::tagById(id);
    return t ? t->color : QString();
}

bool App::isEditable(const QString &type) const
{
    static const QStringList editable = {QStringLiteral("text"), QStringLiteral("code"), QStringLiteral("link"), QStringLiteral("color"),
                                         QStringLiteral("character")};
    return editable.contains(type);
}

QString App::content(const QString &id) const
{
    const Item *i = m_store->find(id);
    return i ? i->content : QString();
}

QString App::relativeTime(double ms) const
{
    const qint64 s = std::max<qint64>(0, (QDateTime::currentMSecsSinceEpoch() - qint64(ms)) / 1000);
    if (s < 60)
        return i18n("just now");
    const qint64 m = s / 60;
    if (m < 60)
        return i18np("%1 minute ago", "%1 minutes ago", m);
    const qint64 h = m / 60;
    if (h < 24)
        return i18np("%1 hour ago", "%1 hours ago", h);
    const qint64 d = h / 24;
    if (d == 1)
        return i18n("yesterday");
    if (d < 7)
        return i18np("%1 day ago", "%1 days ago", d);
    if (d < 30)
        return i18np("%1 week ago", "%1 weeks ago", d / 7);
    if (d < 365)
        return i18np("%1 month ago", "%1 months ago", d / 30);
    return i18np("%1 year ago", "%1 years ago", d / 365);
}

QVariantList App::colorConversions(const QString &id) const
{
    const Item *i = m_store->find(id);
    if (!i || i->type != QLatin1String("color"))
        return {};
    const QColor c = Util::parseCssColor(i->content);
    if (!c.isValid())
        return {};
    const QString cur = i->content.trimmed().toLower();
    QVariantList out;
    const QList<std::pair<QString, QString>> forms = {
        {QStringLiteral("Hex"), Util::hexOf(c)}, {QStringLiteral("RGB"), Util::rgbOf(c)}, {QStringLiteral("HSL"), Util::hslOf(c)}};
    for (const auto &[name, value] : forms) {
        if (value.toLower() != cur)
            out << QVariantMap{{QStringLiteral("label"), i18n("Paste as %1: %2", name, value)}, {QStringLiteral("value"), value}};
    }
    return out;
}

// ---------- item actions ----------
void App::choose(const QString &id, bool shift, bool ctrl)
{
    if (ctrl)
        return activate(id, QStringLiteral("action"));
    bool paste = m_settings->boolValue(QStringLiteral("pasteOnSelect"));
    if (shift)
        paste = !paste;
    activate(id, paste ? QStringLiteral("paste") : QStringLiteral("copy"));
}

void App::activate(const QString &id, const QString &mode)
{
    const Item *item = m_store->find(id);
    if (!item)
        return;
    if (mode == QLatin1String("copy")) {
        m_capture->copy(id);
        close();
    } else if (mode == QLatin1String("action")) {
        close();
        const QString type = item->type;
        if (type == QLatin1String("link") || type == QLatin1String("file") || type == QLatin1String("image"))
            openItem(id);
        else if (type == QLatin1String("files"))
            pasteLater(id, m_store->paths(*item).join(QLatin1Char(' ')), true);
        else
            pasteLater(id, {}, false);
    } else {
        close();
        pasteLater(id, {}, false);
    }
}

void App::pasteText(const QString &id, const QString &text)
{
    close();
    pasteLater(id, text, true);
}

void App::pastePaths(const QString &id)
{
    const Item *item = m_store->find(id);
    if (!item)
        return;
    QStringList quoted;
    for (const QString &p : m_store->paths(*item))
        quoted << shellQuote(p);
    pasteText(id, quoted.join(QLatin1Char(' ')));
}

QString App::shellQuote(const QString &p) const
{
    static const QRegularExpression unsafe(QStringLiteral("[^\\w@%+=:,./-]"));
    if (!unsafe.match(p).hasMatch())
        return p;
    QString q = p;
    q.replace(QLatin1Char('\''), QStringLiteral("'\\''"));
    return QLatin1Char('\'') + q + QLatin1Char('\'');
}

// Copy, then send the paste keys to the focused window once the bar is gone.
void App::pasteLater(const QString &id, const QString &asText, bool hasText)
{
    if (hasText)
        m_capture->copyText(asText);
    else if (m_capture->isCurrent(id))
        m_store->touch(id);   // keep the source's own formats (HTML, rich text...)
    else if (!m_capture->copy(id))
        return;
    QTimer::singleShot(PASTE_DELAY_MS, this, [this]() {
        if (m_paster)
            m_paster->sendPaste(m_kwin->activeIsTerminal());
    });
}

void App::openItem(const QString &id)
{
    const Item *item = m_store->find(id);
    if (!item)
        return;
    close();
    if (item->type == QLatin1String("image"))
        QDesktopServices::openUrl(QUrl::fromLocalFile(m_store->imagePath(*item)));
    else
        QDesktopServices::openUrl(QUrl(item->content.trimmed()));
}

void App::showInFolder(const QString &id)
{
    const Item *item = m_store->find(id);
    if (!item)
        return;
    close();
    const QStringList ps = m_store->paths(*item);
    if (ps.isEmpty())
        return;
    auto msg = QDBusMessage::createMethodCall(QStringLiteral("org.freedesktop.FileManager1"), QStringLiteral("/org/freedesktop/FileManager1"),
                                              QStringLiteral("org.freedesktop.FileManager1"), QStringLiteral("ShowItems"));
    msg << QStringList{QUrl::fromLocalFile(ps.first()).toString()} << QString();
    QDBusConnection::sessionBus().asyncCall(msg);
}

void App::togglePin(const QString &id)
{
    const Item *i = m_store->find(id);
    if (i)
        m_store->update(id, {{QStringLiteral("pinned"), !i->pinned}});
}

void App::setTag(const QString &id, const QString &tag)
{
    const Item *i = m_store->find(id);
    if (i)
        m_store->update(id, {{QStringLiteral("tag"), i->tag == tag ? QString() : tag}});
}

void App::clearTag(const QString &id)
{
    m_store->update(id, {{QStringLiteral("tag"), QString()}});
}

void App::setTitle(const QString &id, const QString &title)
{
    const Item *i = m_store->find(id);
    if (!i)
        return;
    const QString t = title.trimmed();
    m_store->update(id, {{QStringLiteral("title"), t == Store::typeName(i->type) ? QString() : t}});
}

bool App::deleteItem(const QString &id, bool force)
{
    const Item *i = m_store->find(id);
    if (!i)
        return true;
    if (!force && m_store->isProtected(*i))
        return false;
    m_store->remove(id);
    return true;
}

void App::updateContent(const QString &id, const QString &text)
{
    const Item *i = m_store->find(id);
    if (!i || text.trimmed().isEmpty() || text == i->content)
        return;
    QVariantMap meta = i->meta;
    meta.remove(QStringLiteral("link"));
    m_store->update(id, {{QStringLiteral("content"), text}, {QStringLiteral("hash"), Util::md5(text.toUtf8())}, {QStringLiteral("meta"), meta}});
    m_capture->redetect(id);
    const Item *after = m_store->find(id);
    if (after && after->type == QLatin1String("link"))
        m_links->ensure(id);
}

void App::clearHistory(bool includeProtected)
{
    m_store->clear(includeProtected);
}
