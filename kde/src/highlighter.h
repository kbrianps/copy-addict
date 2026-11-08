// Code detection and syntax colours with highlight.js, run on a worker thread
// (detection over ~190 grammars takes long enough to stutter the UI).
#pragma once

#include <QHash>
#include <QJSValue>
#include <QObject>
#include <QSet>
#include <QThread>
#include <QVariantMap>

#include <functional>

class QJSEngine;
class QTimer;

class HighlightWorker : public QObject
{
    Q_OBJECT
public:
    void init(const QString &hljsPath, const QString &helpersSource);
    void detect(quint64 requestId, const QString &text);
    void render(const QString &key, const QString &code, const QString &lang, bool lineNumbers);

Q_SIGNALS:
    void ready(int languages, const QStringList &names);
    void detected(quint64 requestId, const QVariantMap &language);
    void rendered(const QString &key, const QString &html);

private:
    int load(QStringList *names = nullptr);
    void unload();
    void touch();

    QJSEngine *m_engine = nullptr;
    QJSValue m_helpers;
    QString m_patched;
    QString m_source;
    QTimer *m_idle = nullptr;
    int m_count = 0;
};

class Highlighter : public QObject
{
    Q_OBJECT
public:
    explicit Highlighter(QObject *parent = nullptr);
    ~Highlighter() override;

    bool isLoaded() const { return m_loaded; }
    int languageCount() const { return m_languageCount; }

    // Calls back with { id, name } of the language, or an empty map for plain text.
    void detect(const QString &text, std::function<void(const QVariantMap &)> callback);

    // Highlighted HTML for a preview. Until the worker has it, returns plain escaped text
    // and emits rendered(key) once the coloured version is ready.
    QString html(const QString &key, const QString &code, const QString &lang, bool lineNumbers);
    bool hasHtml(const QString &key) const { return m_cache.contains(key); }
    QString languageForExtension(const QString &ext) const;

Q_SIGNALS:
    void loaded();
    void rendered(const QString &key);

private:
    QThread m_thread;
    HighlightWorker *m_worker;
    bool m_loaded = false;
    int m_languageCount = 0;
    QSet<QString> m_languages;
    quint64 m_nextRequest = 1;
    QHash<quint64, std::function<void(const QVariantMap &)>> m_callbacks;
    QHash<QString, QString> m_cache;
    QSet<QString> m_pending;
};
