#include "kwinbridge.h"
#include "util.h"

#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusReply>
#include <QDir>
#include <QFile>

static const QString PLUGIN = QStringLiteral("copy-addict-tracker");

static const QStringList TERMINALS = {
    QStringLiteral("ghostty"), QStringLiteral("gnome-terminal"), QStringLiteral("kitty"), QStringLiteral("alacritty"),
    QStringLiteral("tilix"), QStringLiteral("xterm"), QStringLiteral("konsole"), QStringLiteral("wezterm"),
    QStringLiteral("terminator"), QStringLiteral("xfce4-terminal"), QStringLiteral("mate-terminal"), QStringLiteral("foot"),
    QStringLiteral("urxvt"), QStringLiteral("sakura"), QStringLiteral("guake"), QStringLiteral("terminology"),
    QStringLiteral("blackbox"), QStringLiteral("ptyxis"), QStringLiteral("yakuake"), QStringLiteral("rio"),
};

KWinBridge::KWinBridge(QObject *parent)
    : QObject(parent)
{
}

KWinBridge::~KWinBridge()
{
    QDBusInterface scripting(QStringLiteral("org.kde.KWin"), QStringLiteral("/Scripting"), QStringLiteral("org.kde.kwin.Scripting"));
    scripting.call(QStringLiteral("unloadScript"), PLUGIN);
}

void KWinBridge::start()
{
    // KWin loads scripts from a file path: copy ours out of the resources.
    QDir().mkpath(Util::cacheDir());
    const QString path = Util::cacheDir() + QStringLiteral("/kwin-tracker.js");
    QFile src(QStringLiteral(":/qt/qml/CopyAddict/kwin/tracker.js"));
    if (!src.open(QIODevice::ReadOnly) || !Util::writePrivateFile(path, src.readAll())) {
        qWarning("copy-addict: could not write the KWin script");
        return;
    }
    QDBusInterface scripting(QStringLiteral("org.kde.KWin"), QStringLiteral("/Scripting"), QStringLiteral("org.kde.kwin.Scripting"));
    scripting.call(QStringLiteral("unloadScript"), PLUGIN);
    QDBusReply<int> id = scripting.call(QStringLiteral("loadScript"), path, PLUGIN);
    if (!id.isValid() || id.value() < 0) {
        qWarning("copy-addict: KWin did not load the tracker script: %s", qPrintable(id.error().message()));
        return;
    }
    QDBusInterface script(QStringLiteral("org.kde.KWin"), QStringLiteral("/Scripting/Script%1").arg(id.value()), QStringLiteral("org.kde.kwin.Script"));
    script.call(QStringLiteral("run"));
}

void KWinBridge::windowActivated(const QString &resourceClass, const QString &resourceName, const QString &caption)
{
    Q_UNUSED(caption)
    const QString cls = resourceClass.toLower();
    // Our own bar taking the keyboard is not "the app the user is in".
    if (cls.contains(QLatin1String("copy-addict")))
        return;
    m_class = cls;
    m_name = resourceName.toLower();
}

QString KWinBridge::activeClass() const
{
    return QStringLiteral("%1 %2").arg(m_class, m_name).trimmed();
}

bool KWinBridge::activeIsTerminal() const
{
    const QString cls = activeClass();
    for (const QString &t : TERMINALS) {
        if (cls.contains(t))
            return true;
    }
    return false;
}
