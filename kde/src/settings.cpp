#include "settings.h"
#include "util.h"

#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>

static QString settingsFile()
{
    return Util::configDir() + QStringLiteral("/settings.json");
}

QVariantMap Settings::defaults()
{
    return {
        {QStringLiteral("historyLength"), 30},           // unpinned and untagged items kept
        {QStringLiteral("historyMinutes"), 0},           // 0 = no time limit
        {QStringLiteral("onNewSession"), QStringLiteral("keep-all")},
        {QStringLiteral("protectPinned"), true},
        {QStringLiteral("protectTagged"), true},
        {QStringLiteral("pasteOnSelect"), true},
        {QStringLiteral("copySound"), true},
        {QStringLiteral("copySoundFile"), QString()},
        {QStringLiteral("showTrayIcon"), true},
        {QStringLiteral("incognito"), false},
        {QStringLiteral("excludedApps"), QString()},     // comma separated window classes
        {QStringLiteral("position"), QStringLiteral("bottom")},
        {QStringLiteral("itemWidth"), 250},
        {QStringLiteral("itemHeight"), 170},
        {QStringLiteral("imageFit"), QStringLiteral("cover")},
    };
}

Settings::Settings(QObject *parent)
    : QQmlPropertyMap(this, parent)
{
    m_saveTimer.setSingleShot(true);
    m_saveTimer.setInterval(300);
    connect(&m_saveTimer, &QTimer::timeout, this, &Settings::saveNow);
    // Changes made from QML arrive here after updateValue().
    connect(this, &QQmlPropertyMap::valueChanged, this, [this](const QString &key, const QVariant &) {
        scheduleSave();
        Q_EMIT keyChanged(key);
    });
    load();
}

void Settings::load()
{
    const QVariantMap defs = defaults();
    for (auto it = defs.cbegin(); it != defs.cend(); ++it)
        insert(it.key(), it.value());
    QFile f(settingsFile());
    if (!f.open(QIODevice::ReadOnly))
        return;
    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    for (auto it = o.constBegin(); it != o.constEnd(); ++it) {
        if (defs.contains(it.key()))
            insert(it.key(), it.value().toVariant());
    }
}

QVariant Settings::updateValue(const QString &key, const QVariant &input)
{
    // Keep the stored type (QML may hand us doubles for ints).
    const QVariant def = defaults().value(key);
    if (def.typeId() == QMetaType::Int)
        return input.toInt();
    if (def.typeId() == QMetaType::Bool)
        return input.toBool();
    if (def.typeId() == QMetaType::QString)
        return input.toString();
    return input;
}

void Settings::set(const QString &key, const QVariant &v)
{
    const QVariant nv = updateValue(key, v);
    if (value(key) == nv)
        return;
    insert(key, nv);
    scheduleSave();
    Q_EMIT keyChanged(key);
}

void Settings::resetDefaults()
{
    const QVariantMap defs = defaults();
    for (auto it = defs.cbegin(); it != defs.cend(); ++it)
        set(it.key(), it.value());
}

QStringList Settings::excludedApps() const
{
    QStringList out;
    for (const QString &s : stringValue(QStringLiteral("excludedApps")).split(QLatin1Char(','), Qt::SkipEmptyParts)) {
        const QString t = s.trimmed().toLower();
        if (!t.isEmpty())
            out << t;
    }
    return out;
}

void Settings::scheduleSave()
{
    m_saveTimer.start();
}

void Settings::saveNow()
{
    QJsonObject o;
    for (const QString &k : keys())
        o.insert(k, QJsonValue::fromVariant(value(k)));
    QDir().mkpath(Util::configDir());
    Util::writePrivateFile(settingsFile(), QJsonDocument(o).toJson(QJsonDocument::Indented));
}
