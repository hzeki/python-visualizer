import { useState, useEffect } from "react";

/* ===== AIへの指示（プロンプト） ===== */
const SYSTEM_PROMPT = `あなたはPythonコードの実行ステップを解析する教育支援AIです。
与えられたPythonコードを1行ずつ実行したとき、各ステップで変数がどのように変化するかを解析してください。

以下のJSON形式のみで返答してください（マークダウン・説明文は不要）:
{
  "steps": [
    {
      "line": 0,
      "code": "実行したコードの行（文字列）",
      "vars": { "変数名": "値（文字列）" },
      "explain": "この行で何が起きたかの日本語説明（高校生向けにわかりやすく）",
      "syntax_note": "この行で使われている文法の短い解説（日本語1〜2文）または null",
      "type": "normal | loop | condition_true | condition_false",
      "loop_count": null または 現在のループ回数（数値）,
      "condition_result": null または true/false
    }
  ]
}

typeの意味:
- normal: 通常の処理
- loop: ループの繰り返し処理（forやwhile）
- condition_true: 条件分岐でTrueになった
- condition_false: 条件分岐でFalseになった

ルール:
- lineは0始まりの行番号
- varsにはその時点で存在する全変数を含める
- 値は文字列で表現（リストは "[1, 2, 3]" のように）
- explainは高校生が理解できる平易な日本語で
- syntax_noteは、for / while / if / range / len / リストの添字（a[i]）/ 代入の入れ替えなど、初学者がつまずきやすい文法について、その文法の意味を説明する。同じ行を2回目以降に実行するステップや、説明が不要な単純な行ではnullにする
- loop_countはループの何回目かを示す（1始まり）、ループでなければnull
- condition_resultはif文の評価結果、条件分岐でなければnull
- codeフィールドと変数名・関数名は絶対に翻訳せず、入力されたままの文字列を返す
- 必ずJSONのみ返すこと`;

/* ===== 画面の色分け ===== */
const TYPE_STYLES = {
  normal: { bg: "#f7f7f7", border: "#e0e0e0", label: null },
  loop: { bg: "#eff6ff", border: "#3b82f6", label: "ループ" },
  condition_true: { bg: "#f0fdf4", border: "#22c55e", label: "True" },
  condition_false: { bg: "#fff7ed", border: "#f97316", label: "False" },
};

/* ===== 機能1：サンプルコード ===== */
const SAMPLES = [
  {
    name: "合計を求める",
    code: "total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)",
  },
  {
    name: "最大値を求める",
    code:
      "numbers = [3, 8, 2, 9, 4]\nmax_value = numbers[0]\nfor n in numbers:\n    if n > max_value:\n        max_value = n\nprint(max_value)",
  },
  {
    name: "線形探索",
    code:
      "data = [4, 7, 1, 9, 3]\ntarget = 9\nfound = -1\nfor i in range(len(data)):\n    if data[i] == target:\n        found = i\n        break\nprint(found)",
  },
  {
    name: "バブルソート",
    code:
      "a = [3, 1, 2]\nfor i in range(len(a) - 1):\n    for j in range(len(a) - 1 - i):\n        if a[j] > a[j + 1]:\n            a[j], a[j + 1] = a[j + 1], a[j]\nprint(a)",
  },
];

/* ===== 機能6：解析結果の保存（ブラウザ内） ===== */
const CACHE_KEY = "algo-tool-cache-v2";
function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveCache(key, steps) {
  try {
    const cache = loadCache();
    cache[key] = { steps, t: Date.now() };
    const newest = Object.keys(cache)
      .sort((a, b) => cache[b].t - cache[a].t)
      .slice(0, 20);
    const next = {};
    newest.forEach((k) => (next[k] = cache[k]));
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}

/* ===== 機能3：リストの箱型表示 ===== */
const POINTER_NAMES = ["i", "j", "k", "idx", "index", "pos", "left", "right", "low", "high", "mid"];

function parseList(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  try {
    const json = s
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function ArrayView({ name, arr, prevArr, pointers, changed }) {
  const show = (x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x));
  return (
    <div
      style={{
        background: changed ? "#dbeafe" : "#fff",
        border: `1px solid ${changed ? "#3b82f6" : "#e0e0e0"}`,
        borderRadius: 8,
        padding: "10px 14px",
      }}
    >
      <div style={{ fontSize: 14, color: "#666", fontFamily: "monospace" }}>
        {name}（リスト）{changed && <span style={{ color: "#3b82f6" }}> ← 変化しました</span>}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {arr.map((el, idx) => {
          const elChanged = prevArr ? prevArr[idx] !== el : false;
          const here = pointers.filter((p) => p.value === idx);
          return (
            <div key={idx} style={{ textAlign: "center", minWidth: 56 }}>
              <div style={{ height: 20, fontSize: 14, fontWeight: 700, color: "#c2410c", fontFamily: "monospace" }}>
                {here.length > 0 ? `${here.map((p) => p.name).join(",")} ↓` : ""}
              </div>
              <div
                style={{
                  padding: "10px 6px",
                  fontSize: 22,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  borderRadius: 6,
                  background: elChanged ? "#bfdbfe" : "#f7f7f7",
                  border: `2px solid ${here.length > 0 ? "#f97316" : elChanged ? "#3b82f6" : "#cfcfcf"}`,
                  color: elChanged ? "#1e40af" : "#222",
                }}
              >
                {show(el)}
              </div>
              <div style={{ fontSize: 13, color: "#888", marginTop: 2, fontFamily: "monospace" }}>{idx}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== 画面全体 ===== */
export default function App() {
  const [code, setCode] = useState("");
  const [steps, setSteps] = useState([]);
  const [codeLines, setCodeLines] = useState([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);

  const analyze = async (force = false) => {
    if (!code.trim()) return;
    setError(null);
    setAnalyzed(false);
    setCurrentStep(-1);
    setSteps([]);
    setPlaying(false);
    setFromCache(false);

    const key = code.trim();

    // 機能6：同じコードは保存済みの結果を使う（API を呼ばない）
    if (!force) {
      const hit = loadCache()[key];
      if (hit && Array.isArray(hit.steps)) {
        setSteps(hit.steps);
        setCodeLines(code.split("\n"));
        setAnalyzed(true);
        setFromCache(true);
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: `以下のPythonコードを解析してください:\n\`\`\`python\n${code}\n\`\`\`` },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      if (data.stop_reason === "max_tokens") {
        throw new Error("TOO_LONG");
      }
      const text = data.content.map((i) => i.text || "").join("");
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        throw new Error("EMPTY");
      }
      saveCache(key, parsed.steps);
      setSteps(parsed.steps);
      setCodeLines(code.split("\n"));
      setAnalyzed(true);
    } catch (e) {
      if (e.message === "TOO_LONG") {
        setError("コードが長すぎて、AIの回答が途中で切れました。行数を減らして（目安：10行以内）もう一度お試しください。");
      } else {
        setError("解析に失敗しました。コードを確認してもう一度お試しください。");
      }
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  /* --- 現在のステップから表示する値を計算 --- */
  const prevVars = currentStep > 0 ? steps[currentStep - 1].vars : {};
  const currentVars = currentStep >= 0 ? steps[currentStep].vars : {};
  // AIが返す行番号はずれることがあるため、codeの内容が一致する行を探して補正する
  const resolveLine = (step) => {
    const target = (step.code || "").trim();
    if (!target) return step.line;
    const hits = [];
    codeLines.forEach((l, i) => { if (l.trim() === target) hits.push(i); });
    if (hits.length === 0 || hits.includes(step.line)) return step.line;
    return hits.reduce((a, b) => (Math.abs(b - step.line) < Math.abs(a - step.line) ? b : a));
  };
  const activeLine = currentStep >= 0 ? resolveLine(steps[currentStep]) : -1;
  const currentType = currentStep >= 0 ? steps[currentStep].type : "normal";
  const loopCount = currentStep >= 0 ? steps[currentStep].loop_count : null;
  const condResult = currentStep >= 0 ? steps[currentStep].condition_result : null;
  const explain =
    currentStep >= 0
      ? steps[currentStep].explain
      : "「次へ」を押すか、「自動再生」でコードを1行ずつ実行してみましょう。";
  const typeStyle = TYPE_STYLES[currentType] || TYPE_STYLES.normal;

  // 機能4：同じ行の文法メモは、最初に書かれたものを使い回す
  const syntaxNote =
    currentStep >= 0
      ? steps[currentStep].syntax_note ||
        steps.find((s) => resolveLine(s) === activeLine && s.syntax_note)?.syntax_note ||
        null
      : null;

  // 機能3：i, j などの整数変数を「位置の矢印」として使う
  const pointers = Object.entries(currentVars)
    .filter(([k, v]) => POINTER_NAMES.includes(k) && /^-?\d+$/.test(String(v).trim()))
    .map(([k, v]) => ({ name: k, value: parseInt(v, 10) }));

  /* --- 操作 --- */
  const last = steps.length - 1;
  const handleNext = () => {
    setPlaying(false);
    setCurrentStep((s) => Math.min(s + 1, last));
  };
  const handlePrev = () => {
    setPlaying(false);
    setCurrentStep((s) => Math.max(s - 1, 0));
  };
  const handleReset = () => {
    setPlaying(false);
    setCurrentStep(-1);
  };
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
    } else {
      if (currentStep >= last) setCurrentStep(-1);
      setPlaying(true);
    }
  };

  // 機能2：自動再生
  useEffect(() => {
    if (!playing) return;
    if (currentStep >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCurrentStep((s) => Math.min(s + 1, last)), speed);
    return () => clearTimeout(t);
  }, [playing, currentStep, speed, last]);

  // 機能2：←→キーで操作（入力欄・選択欄では無効）
  useEffect(() => {
    if (!analyzed) return;
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") return;
      if (e.key === "ArrowRight") {
        setPlaying(false);
        setCurrentStep((s) => Math.min(s + 1, last));
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        setCurrentStep((s) => Math.max(s - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analyzed, last]);

  const disabled = loading || !code.trim();
  const btn = (extra = {}) => ({
    padding: "10px 18px",
    borderRadius: 8,
    border: "1px solid #ddd",
    background: "#fff",
    fontSize: 16,
    color: "#444",
    cursor: "pointer",
    ...extra,
  });

  return (
    <div
      translate="no"
      className="notranslate"
      style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 1400, margin: "0 auto", color: "#222" }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 24, color: "#1e40af" }}>Python アルゴリズム学習支援ツール</h2>
        <p style={{ margin: 0, fontSize: 15, color: "#777" }}>
          Pythonコードを入力するとAIがステップごとに解析・説明します
        </p>
      </div>

      {/* 機能1：サンプルコード */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 14, color: "#666" }}>サンプル：</span>
        {SAMPLES.map((s) => (
          <button
            key={s.name}
            onClick={() => {
              setCode(s.code);
              setAnalyzed(false);
              setCurrentStep(-1);
              setPlaying(false);
              setError(null);
            }}
            style={btn({ padding: "6px 14px", fontSize: 14, borderRadius: 20 })}
          >
            {s.name}
          </button>
        ))}
      </div>

      <textarea
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setAnalyzed(false);
          setCurrentStep(-1);
          setPlaying(false);
        }}
        placeholder={"# ここにPythonコードを入力（基礎レベル推奨）"}
        spellCheck={false}
        rows={7}
        style={{
          width: "100%",
          fontFamily: "monospace",
          fontSize: 16,
          padding: 12,
          borderRadius: 8,
          border: "1px solid #ddd",
          background: "#f9f9f9",
          color: "#222",
          boxSizing: "border-box",
          resize: "vertical",
          outline: "none",
        }}
      />

      <button
        onClick={() => analyze(false)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: 12,
          borderRadius: 8,
          border: "none",
          background: disabled ? "#e0e0e0" : "#1e40af",
          color: disabled ? "#aaa" : "#fff",
          fontSize: 17,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          marginTop: 8,
          marginBottom: 20,
        }}
      >
        {loading ? "AIが解析中..." : "AIで解析する"}
      </button>

      {error && (
        <div style={{ padding: 12, background: "#fee2e2", borderRadius: 8, color: "#991b1b", fontSize: 15, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {analyzed && (
        <>
          {/* 機能6：保存済み結果の表示 */}
          {fromCache && (
            <div style={{ padding: "8px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 14, color: "#475569", marginBottom: 12 }}>
              保存済みの解析結果を表示しています（AIは呼び出していません）。
              <button
                onClick={() => analyze(true)}
                style={{ marginLeft: 10, padding: "3px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #94a3b8", background: "#fff", cursor: "pointer" }}
              >
                AIでもう一度解析する
              </button>
            </div>
          )}

          {currentStep >= 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap", minHeight: 32 }}>
              {typeStyle.label && (
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 14, fontWeight: 600, background: typeStyle.bg, border: `1.5px solid ${typeStyle.border}`, color: typeStyle.border }}>
                  {typeStyle.label}
                </span>
              )}
              {loopCount !== null && (
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 14, fontWeight: 600, background: "#eff6ff", border: "1.5px solid #3b82f6", color: "#1e40af" }}>
                  {loopCount}回目のループ
                </span>
              )}
              {condResult !== null && (
                <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 14, fontWeight: 600, background: condResult ? "#f0fdf4" : "#fff7ed", border: `1.5px solid ${condResult ? "#22c55e" : "#f97316"}`, color: condResult ? "#15803d" : "#c2410c" }}>
                  条件の結果：{condResult ? "True（条件を満たす）" : "False（条件を満たさない）"}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
            {/* コード */}
            <div style={{ background: "#f7f7f7", borderRadius: 10, border: "1px solid #e0e0e0", padding: 16, overflowX: "auto" }}>
              <p style={{ fontSize: 14, color: "#888", margin: "0 0 10px" }}>コード</p>
              {codeLines.map((line, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: "monospace",
                    fontSize: 18,
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: i === activeLine ? typeStyle.bg : "transparent",
                    borderLeft: i === activeLine ? `3px solid ${typeStyle.border}` : "3px solid transparent",
                    color: i === activeLine ? "#1e40af" : "#444",
                    fontWeight: i === activeLine ? 600 : 400,
                    transition: "all 0.3s",
                    whiteSpace: "pre",
                  }}
                >
                  <span style={{ color: "#bbb", fontSize: 13, marginRight: 10 }}>{i + 1}</span>
                  {line}
                </div>
              ))}
            </div>

            {/* 変数の状態 */}
            <div style={{ background: "#f7f7f7", borderRadius: 10, border: "1px solid #e0e0e0", padding: 16 }}>
              <p style={{ fontSize: 14, color: "#888", margin: "0 0 10px" }}>変数の状態</p>
              {Object.keys(currentVars).length === 0 ? (
                <p style={{ fontSize: 16, color: "#bbb" }}>（まだ変数はありません）</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(currentVars).map(([k, v]) => {
                    const changed = prevVars[k] !== v;
                    const arr = parseList(v);
                    if (arr) {
                      return (
                        <ArrayView
                          key={k}
                          name={k}
                          arr={arr}
                          prevArr={prevVars[k] !== undefined ? parseList(prevVars[k]) : null}
                          pointers={pointers}
                          changed={changed}
                        />
                      );
                    }
                    return (
                      <div key={k} style={{ background: changed ? "#dbeafe" : "#fff", border: `1px solid ${changed ? "#3b82f6" : "#e0e0e0"}`, borderRadius: 8, padding: "8px 14px", transition: "all 0.3s" }}>
                        <div style={{ fontSize: 14, color: "#888", fontFamily: "monospace" }}>{k}</div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: changed ? "#1e40af" : "#222", fontFamily: "monospace", marginTop: 2 }}>{String(v)}</div>
                        {changed && <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 2 }}>← 変化しました</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* AIの説明 */}
          <div style={{ marginTop: 12, padding: "12px 16px", background: currentStep >= 0 ? typeStyle.bg : "#f7f7f7", borderRadius: 8, borderLeft: `3px solid ${currentStep >= 0 ? typeStyle.border : "#ddd"}`, transition: "all 0.3s" }}>
            <div style={{ fontSize: 14, color: "#888", marginBottom: 4 }}>AIの説明</div>
            <p style={{ fontSize: 18, color: "#1e40af", margin: 0, lineHeight: 1.7 }}>{explain}</p>
          </div>

          {/* 機能4：文法メモ */}
          {syntaxNote && (
            <div style={{ marginTop: 10, padding: "10px 16px", background: "#fefce8", borderRadius: 8, borderLeft: "3px solid #eab308" }}>
              <div style={{ fontSize: 14, color: "#854d0e", marginBottom: 4 }}>文法メモ（この行の書き方の意味）</div>
              <p style={{ fontSize: 16, color: "#422006", margin: 0, lineHeight: 1.7 }}>{syntaxNote}</p>
            </div>
          )}

          {/* 操作：スライダー・自動再生 */}
          <div style={{ marginTop: 16 }}>
            <input
              type="range"
              min={0}
              max={steps.length}
              value={currentStep + 1}
              onChange={(e) => {
                setPlaying(false);
                setCurrentStep(parseInt(e.target.value, 10) - 1);
              }}
              style={{ width: "100%" }}
              aria-label="ステップ位置"
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
              <div style={{ fontSize: 16, color: "#555" }}>
                ステップ <span style={{ fontWeight: 600, color: "#222" }}>{Math.max(currentStep + 1, 0)}</span> / {steps.length}
                <span style={{ marginLeft: 14, fontSize: 13, color: "#999" }}>（←→キーでも操作できます）</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={speed}
                  onChange={(e) => setSpeed(parseInt(e.target.value, 10))}
                  style={{ padding: "9px 8px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, background: "#fff", color: "#444" }}
                  aria-label="再生速度"
                >
                  <option value={2500}>ゆっくり</option>
                  <option value={1500}>ふつう</option>
                  <option value={700}>はやい</option>
                </select>
                <button onClick={handleReset} style={btn()}>最初に戻る</button>
                <button onClick={handlePrev} disabled={currentStep <= 0} style={btn({ background: currentStep <= 0 ? "#f0f0f0" : "#fff", color: currentStep <= 0 ? "#bbb" : "#444", cursor: currentStep <= 0 ? "not-allowed" : "pointer" })}>← 前へ</button>
                <button onClick={togglePlay} style={btn({ border: "1px solid #16a34a", background: playing ? "#dcfce7" : "#fff", color: "#15803d", fontWeight: 600 })}>
                  {playing ? "一時停止" : "自動再生"}
                </button>
                <button onClick={handleNext} disabled={currentStep >= last} style={btn({ padding: "10px 24px", border: "1px solid #1e40af", background: currentStep >= last ? "#e0e0e0" : "#dbeafe", color: currentStep >= last ? "#aaa" : "#1e40af", fontWeight: 600, cursor: currentStep >= last ? "not-allowed" : "pointer" })}>次へ →</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
