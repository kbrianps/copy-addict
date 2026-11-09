// copy-addict: clipboard history for KDE Plasma (Wayland), modelled on Copyous for GNOME.
//   copy-addict             run (normally started by the systemd user service)
//   copy-addict --toggle    open or close the bar of the running instance
//   copy-addict --settings  open the settings window
//   copy-addict --preview   draw the bar without taking the keyboard (screenshots)
//   copy-addict --quit
#include "app.h"

#include <KLocalizedString>

#include <QApplication>
#include <QCommandLineParser>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QIcon>
#include <QLoggingCategory>
#include <QQuickWindow>

static int sendToRunning(const QString &method, const QVariantList &args = {})
{
    auto msg = QDBusMessage::createMethodCall(QStringLiteral("org.kbrianps.CopyAddict"), QStringLiteral("/CopyAddict"),
                                              QStringLiteral("org.kbrianps.CopyAddict"), method);
    msg.setArguments(args);
    const QDBusMessage reply = QDBusConnection::sessionBus().call(msg, QDBus::Block, 3000);
    if (reply.type() == QDBusMessage::ErrorMessage) {
        fprintf(stderr, "copy-addict: %s\n", qPrintable(reply.errorMessage()));
        return 1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    // Plasma asks Qt apps to reconnect when KWin restarts. Here that would leave the
    // fake-input binding and the KWin script tied to the old compositor (paste stops
    // working), so quit instead: the systemd service starts a fresh instance.
    qunsetenv("QT_WAYLAND_RECONNECT");
    QApplication::setDesktopFileName(QStringLiteral("org.kbrianps.copy-addict"));
    QApplication::setApplicationName(QStringLiteral("copy-addict"));
    QApplication::setApplicationVersion(QStringLiteral(COPY_ADDICT_VERSION));
    QQuickWindow::setDefaultAlphaBuffer(true);
    // highlight.min.js is minified: thousands of harmless "used before declaration" notes.
    QLoggingCategory::setFilterRules(QStringLiteral("qt.qml.usedbeforedeclared=false"));
    QApplication qapp(argc, argv);
    QApplication::setApplicationDisplayName(QStringLiteral("copy-addict"));
    QApplication::setQuitOnLastWindowClosed(false);
    QApplication::setWindowIcon(QIcon::fromTheme(QStringLiteral("edit-paste")));
    KLocalizedString::setApplicationDomain("copy-addict");

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("Clipboard history for KDE Plasma"));
    parser.addHelpOption();
    parser.addVersionOption();
    const QCommandLineOption toggle(QStringLiteral("toggle"), QStringLiteral("Open or close the bar"));
    const QCommandLineOption settings(QStringLiteral("settings"), QStringLiteral("Open the settings window"));
    const QCommandLineOption preview(QStringLiteral("preview"), QStringLiteral("Show the bar without taking the keyboard"));
    const QCommandLineOption hide(QStringLiteral("hide"), QStringLiteral("Close the bar"));
    const QCommandLineOption quit(QStringLiteral("quit"), QStringLiteral("Quit the running instance"));
    parser.addOptions({toggle, settings, preview, hide, quit});
    parser.process(qapp);

    const bool running = QDBusConnection::sessionBus().interface()->isServiceRegistered(QStringLiteral("org.kbrianps.CopyAddict"));
    if (running) {
        if (parser.isSet(toggle))
            return sendToRunning(QStringLiteral("toggle"));
        if (parser.isSet(settings))
            return sendToRunning(QStringLiteral("openSettings"));
        if (parser.isSet(preview))
            return sendToRunning(QStringLiteral("showPreview"), {true});
        if (parser.isSet(hide))
            return sendToRunning(QStringLiteral("close"));
        if (parser.isSet(quit))
            return sendToRunning(QStringLiteral("quit"));
        fprintf(stderr, "copy-addict is already running\n");
        return 0;
    }
    if (parser.isSet(quit) || parser.isSet(hide))
        return 0;

    App app;
    if (!app.start(parser.isSet(preview))) {
        fprintf(stderr, "copy-addict: could not register on D-Bus\n");
        return 1;
    }
    if (parser.isSet(settings))
        app.openSettings();
    if (parser.isSet(toggle))
        app.open();
    return qapp.exec();
}
