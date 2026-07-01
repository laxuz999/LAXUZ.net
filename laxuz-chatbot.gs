// Laxuz chatbot v1.3 ｜ 最終更新 2026/07/01 21:34
/****************************************************************
 * Laxuz AIチャットボット 中継スクリプト（Google Apps Script）
 *
 * 役割：サイトのチャットUIから来たメッセージを受け取り、
 *       Google Gemini API に転送して返答を返す「中継役」。
 *       APIキーはこのスクリプト内（サーバー側）に保管するので、
 *       サイトのソースには絶対に出ません。
 *
 * ◆ 導入手順（README参照）
 *   1) Google AI Studio (https://aistudio.google.com/apikey) でAPIキーを取得
 *   2) このスクリプトを Apps Script プロジェクトに貼り付け
 *   3) プロジェクトの設定 → スクリプト プロパティ に
 *        プロパティ名: GEMINI_API_KEY
 *        値        : 取得したAPIキー
 *      を追加して保存
 *   4) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行：自分
 *        アクセスできるユーザー：全員
 *      デプロイし、表示された /exec のURLをコピー
 *   5) そのURLを common.js の LAXUZ_CHAT_URL に貼り付け
 ****************************************************************/

// 使用モデル（現行の標準モデル。低レイテンシ・高頻度向けで価格性能◎）
// ・最新を自動追従したいなら 'gemini-flash-latest'
// ・最安・最速重視なら 'gemini-2.5-flash-lite'
var GEMINI_MODEL = 'gemini-2.5-flash';

// 原因調査用。true の間は、回答できないときにエラー内容を画面に表示します。
// 正常に動いたら false に戻してください。
var DEBUG = false;

// ▼ 問答集（FAQ）スプレッドシート設定
//   料金表と同じスプレッドシート内の「QAbot」シートを読み込みます。
//   A列に質問(Q)、B列に回答(A)を書いてください（見出し行はあってもなくてもOK）。
//   ※スプレッドシートは「リンクを知っている全員」公開のままでOK。
var QA_SHEET_ID   = '1MsiVmU1WiKVBrJKMEp17UbfjL2RD6iFvMGBgffXLB_4';
var QA_SHEET_NAME = 'QAbot';        // ボタン＆回答の元（あなたが用意する想定Q&A）
var QA_LOG_SHEET_NAME = '質問ログ';  // お客様の自由入力の記録先（※ボタンには出ません）
var QA_CACHE_SEC  = 60;  // 問答集の再読込間隔（秒）。シート編集が反映されるまで最大この時間
var QA_MAX_BUTTONS = 8;  // チャットに出す質問ボタンの最大数（QAbotの上から順）

// AIの人格・知識（Laxuzの接客アシスタント）
var SYSTEM_PROMPT =
  'あなたは大阪市東淀川区を拠点とするハウスクリーニング専門店「Laxuz（ラクサス）」の' +
  '公式サイトに常駐するAI接客アシスタントです。お客様の質問に、丁寧でやわらかく、簡潔に日本語で答えます。\n' +
  '\n【店舗情報】\n' +
  '・対応メニュー：エアコン（ノーマル/お掃除機能/高性能）、レンジフード、洗濯機（縦型のみ対応）、浴室クリーニング、室外機・防カビ等のオプション。\n' +
  '・拠点：大阪市東淀川区。大阪府内を中心に出張対応。出張費無料エリア（東淀川区・淀川区など大阪市内〜近郊）と有料エリアがあります。\n' +
  '・営業時間：9:00〜18:00（年中無休）。\n' +
  '・支払い：現金・PayPay・クレジットカード（カードは+4%）。作業完了・ご確認後のお支払い。\n' +
  '・損害保険加入済み。作業前後のビフォーアフター写真をお見せします。\n' +
  '・小さなお子様・ペットのいるご家庭向けに、低刺激・環境対応洗剤への変更オプション（有料）があります。\n' +
  '・駐車場：お客様負担で近隣のコインパーキングをご利用いただきます。\n' +
  '・製造から9年以上経過したエアコンは、部品供給終了等のためお客様の自己責任でのご対応となります。\n' +
  '・追加料金は原則なし（作業前に見積りを提示し、ご納得後に開始）。\n' +
  '・キャンセル料：当日以降100%、前日50%、2〜7日前25%。\n' +
  '\n【料金の目安（税込・1台あたり。変動するため、正確な金額は予約フォームの料金表でご確認ください）】\n' +
  '・ノーマルエアコン 9,000円 / お掃除機能エアコン 15,000円 / 高性能エアコン 20,000円\n' +
  '・縦型洗濯機 15,000円 / レンジフード 15,000円 / 浴槽エプロン 6,000円\n' +
  '・複数台・複数箇所のまとめ依頼は割引あり。\n' +
  '\n【予約・見積りの案内】\n' +
  '・正式なご予約・お見積りは「料金・メニュー表（予約フォーム）」 https://script.google.com/macros/s/AKfycbyO_EIfVKSeyHqWSk-fBH0DENn2jXHyRG2DlfVVJLrK/exec から承ります。\n' +
  '・このチャットでも、機種や状況をお伺いして概算のご案内や相談が可能です。具体的な日程確定は予約フォームへご案内してください。\n' +
  '\n【回答の方針】\n' +
  '・末尾に【店舗のFAQ（問答集）】が付与されている場合は、その質問と回答を最優先で参照して答える。該当する内容があればその回答に沿って答え、無い場合のみ一般知識や上記の店舗情報で答える。\n' +
  '・わからないこと・確証がないことは断定せず、「予約フォームやお問い合わせでご確認ください」と案内する。\n' +
  '・洗濯機はドラム式は非対応（縦型のみ）と正しく伝える。\n' +
  '・長文を避け、要点を3〜5文程度で。絵文字は使わない。\n' +
  '・出力は日本語のプレーンテキスト。Markdown記法（*、**、#、- など）は使わない。' +
  '箇条書きが必要なときは行頭に「・」を使う。\n' +
  '・医療・法律など専門外の断定はしない。料金は「目安」と明示する。';

/**
 * サイトからのPOSTを受ける入口
 * body: { message: "ユーザー発言", history: [{role:'user'|'model', text:'...'}] }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // ① 質問ボタン用のQ&A一覧を返す
    if (body.action === 'list') {
      return _json({ items: getQAList().slice(0, QA_MAX_BUTTONS) });
    }

    var userMsg = (body.message || '').toString().slice(0, 2000);
    var history = Array.isArray(body.history) ? body.history.slice(-12) : [];

    if (!userMsg) {
      return _json({ reply: 'メッセージが空のようです。ご質問を入力してください。' });
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return _json({ reply: '申し訳ありません、ただいま準備中です。少し時間をおいてお試しください。' });
    }

    // 会話履歴を Gemini 形式に変換
    var contents = [];
    history.forEach(function (h) {
      var role = (h.role === 'model') ? 'model' : 'user';
      var text = (h.text || '').toString();
      if (text) contents.push({ role: role, parts: [{ text: text }] });
    });
    contents.push({ role: 'user', parts: [{ text: userMsg }] });

    // 店舗情報＋問答集（FAQ）を合わせてAIへの指示文にする
    var sysText = SYSTEM_PROMPT;
    var qa = getQAText();
    if (qa) sysText += '\n\n' + qa;

    var payload = {
      system_instruction: { parts: [{ text: sysText }] },
      contents: contents,
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 }
    };

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);

    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var raw = res.getContentText();
    Logger.log('Gemini status=' + code + ' body=' + raw);

    var data = {};
    try { data = JSON.parse(raw); } catch (ignore) {}

    var reply = '';
    if (data.candidates && data.candidates[0] && data.candidates[0].content &&
        data.candidates[0].content.parts) {
      reply = data.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('').trim();
    }

    if (!reply) {
      if (DEBUG) {
        var msg = (data.error && data.error.message) ? data.error.message : raw.slice(0, 400);
        var fr = (data.candidates && data.candidates[0] && data.candidates[0].finishReason)
          ? (' / finishReason=' + data.candidates[0].finishReason) : '';
        return _json({ reply: '【DEBUG】HTTP ' + code + fr + ' / ' + msg });
      }
      reply = '申し訳ありません、うまく回答できませんでした。お手数ですが言い回しを変えてお試しいただくか、予約フォーム（https://script.google.com/macros/s/AKfycbyO_EIfVKSeyHqWSk-fBH0DENn2jXHyRG2DlfVVJLrK/exec）からお問い合わせください。';
    }

    // ② お客様が自由入力した質問は QAbot シートのQ列へ自動追加（AIの回答をB列の下書きに）
    if (body.log === true) {
      appendQuestion(userMsg, reply);
    }

    return _json({ reply: reply });

  } catch (err) {
    return _json({ reply: '申し訳ありません、エラーが発生しました。時間をおいて再度お試しください。', error: String(err) });
  }
}

/**
 * 【初回だけ手動で1回実行してください】
 * スプレッドシートへの書き込み（質問の自動追加）の権限を承認するための関数。
 * Apps Scriptエディタ上部の関数選択で「authorizeSheets」を選び、▶実行を押すと
 * 権限の承認画面が出ます。許可すれば、お客様の質問がQAbotシートに追加されるようになります。
 */
function authorizeSheets() {
  var sh = SpreadsheetApp.openById(QA_SHEET_ID).getSheetByName(QA_SHEET_NAME);
  Logger.log(sh ? ('OK: シート「' + sh.getName() + '」に書き込みできます') : ('シートが見つかりません: ' + QA_SHEET_NAME));
}

// 動作確認用（ブラウザで /exec を開いたときの表示）
function doGet() {
  return _json({ ok: true, message: 'Laxuz chatbot relay is running.' });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * QAbotシートを読み込み、[{q, a}, ...] の配列で返す（数十秒キャッシュ）。
 * A列=質問, B列=回答。1行目が見出し（Q/A/質問/回答）なら自動で読み飛ばす。
 */
function getQAList() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('qa_list_v1');
  if (cached !== null) { try { return JSON.parse(cached); } catch (e) {} }

  var items = [];
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + QA_SHEET_ID +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(QA_SHEET_NAME);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var rows = _parseCSV(res.getContentText());
      if (rows.length) {
        var norm = function (h) { return (h || '').replace(/\s/g, '').trim(); };
        var head = rows[0].map(norm);
        var headerKeys = ['質問', '回答', 'Q', 'A', 'q', 'a', 'question', 'answer'];
        var isHeader = head.some(function (h) { return headerKeys.indexOf(h) >= 0; });
        var qi = 0, ai = 1, startRow = 0;
        if (isHeader) {
          var q1 = head.indexOf('質問'); if (q1 < 0) q1 = head.indexOf('Q'); if (q1 < 0) q1 = head.indexOf('q'); if (q1 < 0) q1 = head.indexOf('question');
          var a1 = head.indexOf('回答'); if (a1 < 0) a1 = head.indexOf('A'); if (a1 < 0) a1 = head.indexOf('a'); if (a1 < 0) a1 = head.indexOf('answer');
          qi = q1 >= 0 ? q1 : 0;
          ai = a1 >= 0 ? a1 : 1;
          startRow = 1;
        }
        for (var i = startRow; i < rows.length; i++) {
          var q = (rows[i][qi] || '').trim();
          var a = (rows[i][ai] || '').trim();
          if (!q && !a) continue;
          items.push({ q: q, a: a });
        }
      }
    }
  } catch (e) {}

  cache.put('qa_list_v1', JSON.stringify(items), QA_CACHE_SEC);
  return items;
}

/**
 * QAbotの内容をAIへ渡す指示テキストに整形して返す。
 */
function getQAText() {
  var items = getQAList();
  if (!items.length) return '';
  var blocks = items.map(function (it) { return 'Q: ' + it.q + '\nA: ' + it.a; });
  var text = '【店舗のFAQ（問答集）。お客様の質問に該当するものがあれば、この回答に沿って答えること】\n' +
    blocks.join('\n---\n');
  if (text.length > 12000) text = text.slice(0, 12000);
  return text;
}

/**
 * お客様が自由入力した質問を「質問ログ」シートに記録する。
 * ※ボタンの元（QAbotシート）には追加しないので、お客様自身が聞いた質問が
 *   ボタンに出ることはありません。運営者がログを見て、良い質問だけを
 *   手動でQAbotシートに転記すればボタン化できます。
 */
function appendQuestion(q, a) {
  try {
    q = (q || '').toString().trim();
    if (!q) return;
    var ss = SpreadsheetApp.openById(QA_SHEET_ID);
    var sh = ss.getSheetByName(QA_LOG_SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(QA_LOG_SHEET_NAME);
      sh.appendRow(['質問', 'AIの回答（下書き）', '日時']);
    }
    sh.appendRow([q, (a || '').toString(), new Date()]);
  } catch (e) {}
}

// CSV文字列を2次元配列へ（引用符・改行入りセルに対応）
function _parseCSV(text) {
  var rows = [], row = [], field = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i], next = text[i + 1];
    if (inQ) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return (c || '').trim() !== ''; }); });
}
