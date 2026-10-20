import { useState } from "react";

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
- loop_countはループの何回目かを示す（1始まり）、ループでなければnull
- condition_resultはif文の評価結果、条件分岐でなければnull
- codeフィールドには元のPythonコードをそのまま記載し、絶対に翻訳しないこと
- 変数名・関数名・予約語（print、for、if、while、range等）は日本語に翻訳しないこと
- 必ずJSONのみ返すこと`;

const TYPE_STYLES = {
  normal: { bg: "#f7f7f7", border: "#e0e0e0", label: null },
  loop: { bg: "#eff6ff", border: "#3b82f6", label: " ループ" },
  condition_true: { bg: "#f0fdf4", border: "#22c55e", label: " True" },
  condition_false: { bg: "#fff7ed", border: "#f97316", label: " False" },
};

export default function App() {
  const [code, setCode] = useState("");
  const [steps, setSteps] = useState([]);
  const [codeLines, setCodeLines] = useState([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analyzed, setAnalyzed] = useState(false);

  const analyze = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError(null);
    setAnalyzed(false);
    setCurrentStep(-1);
    setSteps([]);

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
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `以下のPythonコードを解析してください:\n\`\`\`python\n${code}\n\`\`\`` }],
        }),
      });

      const data = await res.json();
      const text = data.content.map((i) => i.text || "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setSteps(parsed.steps);
      setCodeLines(code.split("\n"));
      setAnalyzed(true);
    } catch (e) {
      setError("解析に失敗しました。コードを確認してもう一度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  const prevVars = currentStep > 0 ? steps[currentStep - 1].vars : {};
  const currentVars = currentStep >= 0 ? steps[currentStep].vars : {};
  const activeLine = currentStep >= 0 ? steps[currentStep].line : -1;
  const currentType = currentStep >= 0 ? steps[currentStep].type : "normal";
  const loopCount = currentStep >= 0 ? steps[currentStep].loop_count : null;
  const condResult = currentStep >= 0 ? steps[currentStep].condition_result : null;
  const explain = currentStep >= 0 ? steps[currentStep].explain : "「次のステップへ」を押してコードを1行ずつ実行してみましょう。";

  const typeStyle = TYPE_STYLES[currentType] || TYPE_STYLES.normal;

  const handleNext = () => { if (currentStep < steps.length - 1) setCurrentStep((s) => s + 1); };
  const handlePrev = () => { if (currentStep > 0) setCurrentStep((s) => s - 1); };
  const handleReset = () => setCurrentStep(-1);

  return (
    <div translate="no" className="notranslate" style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "#1e40af" }}>
           Python アルゴリズム学習支援ツール
        </h2>
        <p style={{ margin: 0, fontSize: 12, color: "#888" }}>
          Pythonコードを入力するとAIがステップごとに解析・説明します
        </p>
      </div>

      <textarea
        value={code}
        onChange={(e) => { setCode(e.target.value); setAnalyzed(false); setCurrentStep(-1); }}
        placeholder={"# ここにPythonコードを入力（基礎レベル推奨）"}
        rows={6}
        style={{
          width: "100%", fontFamily: "monospace", fontSize: 13,
          padding: 12, borderRadius: 8, border: "1px solid #ddd",
          background: "#f9f9f9", color:"#222",boxSizing: "border-box", resize: "vertical", outline: "none",
        }}
      />

      <button
        onClick={analyze}
        disabled={loading || !code.trim()}
        style={{
          width: "100%", padding: 10, borderRadius: 8, border: "none",
          background: loading || !code.trim() ? "#e0e0e0" : "#1e40af",
          color: loading || !code.trim() ? "#aaa" : "#fff",
          fontSize: 14, fontWeight: 600,
          cursor: loading || !code.trim() ? "not-allowed" : "pointer",
          marginTop: 8, marginBottom: 20,
        }}
      >
        {loading ? "AIが解析中..." : " AIで解析する"}
      </button>

      {error && (
        <div style={{ padding: 12, background: "#fee2e2", borderRadius: 8, color: "#991b1b", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {analyzed && (
        <>
          {currentStep >= 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              {typeStyle.label && (
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: typeStyle.bg, border: `1.5px solid ${typeStyle.border}`, color: typeStyle.border }}>
                  {typeStyle.label}
                </span>
              )}
              {loopCount !== null && (
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#eff6ff", border: "1.5px solid #3b82f6", color: "#1e40af" }}>
                  {loopCount}回目のループ
                </span>
              )}
              {condResult !== null && (
                <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: condResult ? "#f0fdf4" : "#fff7ed", border: `1.5px solid ${condResult ? "#22c55e" : "#f97316"}`, color: condResult ? "#15803d" : "#c2410c" }}>
                  条件の結果：{condResult ? "True（条件を満たす）" : "False（条件を満たさない）"}
                </span>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "#f7f7f7", borderRadius: 10, border: "1px solid #e0e0e0", padding: 16 }}>
              <p style={{ fontSize: 11, color: "#999", margin: "0 0 10px" }}>コード</p>
              {codeLines.map((line, i) => (
                <div key={i} style={{ fontFamily: "monospace", fontSize: 13, padding: "4px 10px", borderRadius: 4, background: i === activeLine ? typeStyle.bg : "transparent", borderLeft: i === activeLine ? `3px solid ${typeStyle.border}` : "3px solid transparent", color: i === activeLine ? "#1e40af" : "#444", fontWeight: i === activeLine ? 600 : 400, transition: "all 0.3s", whiteSpace: "pre" }}>
                  <span style={{ color: "#bbb", fontSize: 11, marginRight: 8 }}>{i + 1}</span>
                  {line}
                </div>
              ))}
            </div>

            <div style={{ background: "#f7f7f7", borderRadius: 10, border: "1px solid #e0e0e0", padding: 16 }}>
              <p style={{ fontSize: 11, color: "#999", margin: "0 0 10px" }}>変数の状態</p>
              {Object.keys(currentVars).length === 0 ? (
                <p style={{ fontSize: 13, color: "#bbb" }}>（まだ変数はありません）</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(currentVars).map(([k, v]) => {
                    const changed = prevVars[k] !== v;
                    return (
                      <div key={k} style={{ background: changed ? "#dbeafe" : "#fff", border: `1px solid ${changed ? "#3b82f6" : "#e0e0e0"}`, borderRadius: 8, padding: "8px 14px", transition: "all 0.3s" }}>
                        <div style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>{k}</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: changed ? "#1e40af" : "#222", fontFamily: "monospace", marginTop: 2 }}>{String(v)}</div>
                        {changed && <div style={{ fontSize: 10, color: "#3b82f6", marginTop: 2 }}>← 変化しました</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 12, padding: "12px 16px", background: currentStep >= 0 ? typeStyle.bg : "#f7f7f7", borderRadius: 8, borderLeft: `3px solid ${currentStep >= 0 ? typeStyle.border : "#ddd"}`, transition: "all 0.3s" }}>
            <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>AIの説明</div>
            <p style={{ fontSize: 13, color: "#1e40af", margin: 0, lineHeight: 1.7 }}>{explain}</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <div style={{ fontSize: 13, color: "#666" }}>
              ステップ <span style={{ fontWeight: 600, color: "#222" }}>{Math.max(currentStep + 1, 0)}</span> / {steps.length}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleReset} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", fontSize: 13, color: "#555", cursor: "pointer" }}>最初に戻る</button>
              <button onClick={handlePrev} disabled={currentStep <= 0} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #ddd", background: currentStep <= 0 ? "#f0f0f0" : "#fff", fontSize: 13, color: currentStep <= 0 ? "#bbb" : "#555", cursor: currentStep <= 0 ? "not-allowed" : "pointer" }}>← 前へ</button>
              <button onClick={handleNext} disabled={currentStep >= steps.length - 1} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #1e40af", background: currentStep >= steps.length - 1 ? "#e0e0e0" : "#dbeafe", fontSize: 13, color: currentStep >= steps.length - 1 ? "#aaa" : "#1e40af", fontWeight: 600, cursor: currentStep >= steps.length - 1 ? "not-allowed" : "pointer" }}>次へ →</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}