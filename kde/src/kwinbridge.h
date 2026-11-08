// Talks to KWin: loads a small script that reports the active window over D-Bus.
#pragma once

#include <QObject>

class KWinBridge : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.kbrianps.CopyAddict.KWinBridge")
public:
    explicit KWinBridge(QObject *parent = nullptr);
    ~KWinBridge() override;

    void start();                       // call after the D-Bus service is registered
    QString activeClass() const;        // "resourceclass resourcename", lower case
    bool activeIsTerminal() const;

public Q_SLOTS:
    Q_SCRIPTABLE void windowActivated(const QString &resourceClass, const QString &resourceName, const QString &caption);

private:
    QString m_class;
    QString m_name;
};
