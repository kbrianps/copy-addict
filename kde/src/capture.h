// Clipboard capture, type detection, and putting items back on the clipboard.
#pragma once

#include "store.h"

#include <QObject>
#include <QTimer>

class KSystemClipboard;
class Settings;
class Highlighter;
class LinkPreview;
class KWinBridge;

class Capture : public QObject
{
    Q_OBJECT
public:
    Capture(Store *store, Settings *settings, Highlighter *highlighter, LinkPreview *links, KWinBridge *kwin, QObject *parent = nullptr);

    bool copy(const QString &id);           // put an item back on the clipboard
    void copyText(const QString &text);
    bool isCurrent(const QString &id) const;   // the clipboard still holds this item (with its original formats)
    void redetect(const QString &id);       // re-run type detection (after editing, or when highlight.js loads)
    void redetectAll();

    bool paused = false;

Q_SIGNALS:
    void newItem(const QString &id);
    void userCopied();

private:
    struct Job {
        Item entry;
        bool ready = false;
    };

    void read();
    bool shouldSave(const QStringList &formats) const;
    void queueText(const QString &text);
    void queueReady(const Item &entry);
    void flush();
    void save(const Item &entry);
    void playSound();

    Store *m_store;
    Settings *m_settings;
    Highlighter *m_highlighter;
    LinkPreview *m_links;
    KWinBridge *m_kwin;
    KSystemClipboard *m_clipboard;
    QTimer m_debounce;
    QList<std::shared_ptr<Job>> m_jobs;    // keeps captures in order while code detection runs
    QString m_prevType, m_prevHash;        // last thing seen or set by us
    QStringList m_prevPaths;
    QString m_curType, m_curHash;          // what the clipboard holds right now, if known
    qint64 m_ownCopyUntil = 0;
};
