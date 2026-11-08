#include "highlighter.h"
#include "util.h"

#include <QFile>
#include <QJSEngine>
#include <QStandardPaths>
#include <QTimer>

#include <malloc.h>

static QString findHighlightJs()
{
    const QStringList candidates = {
        Util::dataDir() + QStringLiteral("/highlight.min.js"),
        QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + QStringLiteral("/copyous@boerdereinar.dev/highlight.min.js"),
    };
    for (const QString &p : candidates) {
        if (QFile::exists(p))
            return p;
    }
    return {};
}

// Qt's JS engine rejects two things highlight.js uses: "__proto__: null" in object
// literals, and Unicode property escapes (\p{...}) in regexes. Load a patched copy.
static QString patchedCopy(const QString &path)
{
    QFile in(path);
    if (!in.open(QIODevice::ReadOnly))
        return {};
    QString src = QString::fromUtf8(in.readAll());
    src.remove(QStringLiteral("__proto__:null,"));
    src.replace(QStringLiteral("/[\\p{XID_Start}_]\\p{XID_Continue}*/u"), QStringLiteral("/[A-Za-z\\u00AA-\\uFFFF_][\\w\\u00AA-\\uFFFF]*/u"));
    src.replace(QStringLiteral("\\p{L}"), QStringLiteral("A-Za-z\\u00AA-\\uFFFF"));
    const QString out = Util::cacheDir() + QStringLiteral("/highlight.patched.mjs");
    return Util::writePrivateFile(out, src.toUtf8()) ? out : QString();
}

// ---------- worker (own thread, own JS engine) ----------
// The engine with highlight.js costs ~35 MB, and is only needed right after a copy or
// while previews render: it is loaded on demand and dropped after a while unused.
static const int IDLE_UNLOAD_MS = 120000;

void HighlightWorker::init(const QString &hljsPath, const QString &helpersSource)
{
    m_source = helpersSource;
    m_patched = hljsPath.isEmpty() ? QString() : patchedCopy(hljsPath);
    m_idle = new QTimer(this);
    m_idle->setSingleShot(true);
    m_idle->setInterval(IDLE_UNLOAD_MS);
    connect(m_idle, &QTimer::timeout, this, &HighlightWorker::unload);
    QStringList names;
    const int count = load(&names);
    touch();
    Q_EMIT ready(count, names);
}

// Returns the number of languages (0 = highlight.js unavailable); fills names on request.
int HighlightWorker::load(QStringList *names)
{
    if (m_engine)
        return m_count;
    m_engine = new QJSEngine(this);
    m_engine->installExtensions(QJSEngine::ConsoleExtension);
    QJSValue hljs = QJSValue::NullValue;
    if (!m_patched.isEmpty()) {
        QJSValue ns = m_engine->importModule(m_patched);
        QJSValue def = ns.property(QStringLiteral("default"));
        if (m_engine->hasError() || ns.isError() || !def.isObject() || def.isError())
            qWarning("copy-addict: highlight.js failed to load: %s", qPrintable(m_engine->hasError() ? m_engine->catchError().toString() : ns.toString()));
        else
            hljs = def;
    }
    QJSValue factory = m_engine->evaluate(m_source, QStringLiteral("hl-helpers.js"));
    if (!factory.isError())
        m_helpers = factory.call({hljs});
    if (factory.isError() || m_helpers.isError()) {
        qWarning("copy-addict: hl-helpers.js: %s", qPrintable((factory.isError() ? factory : m_helpers).toString()));
        m_helpers = QJSValue();
        m_count = 0;
        return 0;
    }
    m_count = m_helpers.property(QStringLiteral("count")).toInt();
    if (names && hljs.isObject()) {
        const QJSValue list = hljs.property(QStringLiteral("listLanguages")).callWithInstance(hljs);
        const int n = list.property(QStringLiteral("length")).toInt();
        for (int i = 0; i < n; ++i) {
            const QString name = list.property(i).toString();
            *names << name;
            const QJSValue lang = hljs.property(QStringLiteral("getLanguage")).callWithInstance(hljs, {name});
            const QJSValue aliases = lang.property(QStringLiteral("aliases"));
            const int na = aliases.property(QStringLiteral("length")).toInt();
            for (int j = 0; j < na; ++j)
                *names << aliases.property(j).toString();
        }
    }
    return m_count;
}

void HighlightWorker::unload()
{
    m_helpers = QJSValue();
    delete m_engine;
    m_engine = nullptr;
    malloc_trim(0);   // give the freed heap back to the system
}

void HighlightWorker::touch()
{
    if (m_idle)
        m_idle->start();
}

void HighlightWorker::detect(quint64 requestId, const QString &text)
{
    QVariantMap out;
    if (load() > 0 && m_helpers.isObject()) {
        const QJSValue r = m_helpers.property(QStringLiteral("detect")).call({text});
        if (r.isObject()) {
            out[QStringLiteral("id")] = r.property(QStringLiteral("id")).toString();
            out[QStringLiteral("name")] = r.property(QStringLiteral("name")).toString();
        }
    }
    touch();
    Q_EMIT detected(requestId, out);
}

void HighlightWorker::render(const QString &key, const QString &code, const QString &lang, bool lineNumbers)
{
    QString html;
    if (load() > 0 && m_helpers.isObject()) {
        const QJSValue r = m_helpers.property(QStringLiteral("highlight")).call({code, lang, lineNumbers});
        if (!r.isError())
            html = r.toString();
    }
    touch();
    if (html.isEmpty())
        html = QStringLiteral("<pre style=\"margin:0\">%1</pre>").arg(code.toHtmlEscaped());
    Q_EMIT rendered(key, html);
}

// ---------- front end (main thread) ----------
Highlighter::Highlighter(QObject *parent)
    : QObject(parent)
    , m_worker(new HighlightWorker)
{
    m_worker->moveToThread(&m_thread);
    connect(&m_thread, &QThread::finished, m_worker, &QObject::deleteLater);
    connect(m_worker, &HighlightWorker::ready, this, [this](int count, const QStringList &names) {
        m_loaded = count > 0;
        m_languageCount = count;
        m_languages = QSet<QString>(names.cbegin(), names.cend());
        if (m_loaded)
            qInfo("copy-addict: highlight.js loaded (%d languages)", count);
        else
            qInfo("copy-addict: highlight.js not found, code detection off");
        Q_EMIT loaded();
    });
    connect(m_worker, &HighlightWorker::detected, this, [this](quint64 id, const QVariantMap &lang) {
        auto cb = m_callbacks.take(id);
        if (cb)
            cb(lang);
    });
    connect(m_worker, &HighlightWorker::rendered, this, [this](const QString &key, const QString &html) {
        m_pending.remove(key);
        m_cache.insert(key, html);
        Q_EMIT rendered(key);
    });
    m_thread.setObjectName(QStringLiteral("highlight.js"));
    m_thread.start(QThread::LowPriority);

    QFile helpers(QStringLiteral(":/qt/qml/CopyAddict/src/hl-helpers.js"));
    if (!helpers.open(QIODevice::ReadOnly))
        qWarning("copy-addict: hl-helpers.js missing from the resources");
    const QString source = QString::fromUtf8(helpers.readAll());
    const QString path = findHighlightJs();
    QMetaObject::invokeMethod(m_worker, [w = m_worker, path, source]() { w->init(path, source); }, Qt::QueuedConnection);
}

Highlighter::~Highlighter()
{
    m_thread.quit();
    m_thread.wait(2000);
}

void Highlighter::detect(const QString &text, std::function<void(const QVariantMap &)> callback)
{
    const quint64 id = m_nextRequest++;
    m_callbacks.insert(id, std::move(callback));
    QMetaObject::invokeMethod(m_worker, [w = m_worker, id, text]() { w->detect(id, text); }, Qt::QueuedConnection);
}

QString Highlighter::html(const QString &key, const QString &code, const QString &lang, bool lineNumbers)
{
    auto it = m_cache.constFind(key);
    if (it != m_cache.constEnd())
        return *it;
    if (!m_pending.contains(key)) {
        m_pending.insert(key);
        QMetaObject::invokeMethod(m_worker, [w = m_worker, key, code, lang, lineNumbers]() { w->render(key, code, lang, lineNumbers); },
                                  Qt::QueuedConnection);
    }
    return QStringLiteral("<pre style=\"margin:0;white-space:%1\">%2</pre>")
        .arg(code.contains(QLatin1Char('\n')) ? QStringLiteral("pre") : QStringLiteral("pre-wrap"), code.toHtmlEscaped());
}

QString Highlighter::languageForExtension(const QString &ext) const
{
    return !ext.isEmpty() && m_languages.contains(ext) ? ext : QString();
}
