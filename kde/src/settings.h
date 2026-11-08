// User settings, kept in ~/.config/copy-addict/settings.json.
// QML reads and writes them as plain properties (settings.itemWidth = 300).
#pragma once

#include <QQmlPropertyMap>
#include <QTimer>

class Settings : public QQmlPropertyMap
{
    Q_OBJECT
public:
    explicit Settings(QObject *parent = nullptr);

    QVariant get(const QString &key) const { return value(key); }
    int intValue(const QString &key) const { return value(key).toInt(); }
    bool boolValue(const QString &key) const { return value(key).toBool(); }
    QString stringValue(const QString &key) const { return value(key).toString(); }
    QStringList excludedApps() const;

    Q_INVOKABLE void set(const QString &key, const QVariant &v);
    Q_INVOKABLE void resetDefaults();

Q_SIGNALS:
    void keyChanged(const QString &key);

protected:
    QVariant updateValue(const QString &key, const QVariant &input) override;

private:
    void load();
    void scheduleSave();
    void saveNow();
    static QVariantMap defaults();

    QTimer m_saveTimer;
};
