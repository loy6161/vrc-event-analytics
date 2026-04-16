import '../styles/HelpPage.css'

export function HelpPage() {
  return (
    <div className="help-container">
      <div className="help-header">
        <h1>VRChat Event Analytics ヘルプ</h1>
        <p className="help-subtitle">ユーザーマニュアル</p>
      </div>

      {/* Quick Start */}
      <section className="help-section">
        <h2>クイックスタート</h2>
        <div className="help-steps">
          <div className="help-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <h3>ログファイルをインポート</h3>
              <p>
                サイドバーの <strong>📂 ログ取込</strong> を開き、VRChatの
                <code>output_log</code> ファイルをドラッグ＆ドロップします。
                イベントが自動的に作成されます。
              </p>
            </div>
          </div>
          <div className="help-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <h3>イベントを確認</h3>
              <p>
                <strong>📅 Events</strong> でインポートされたイベント一覧を確認。
                イベントをクリックすると詳細な分析が表示されます。
              </p>
            </div>
          </div>
          <div className="help-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <h3>分析データを活用</h3>
              <p>
                ダッシュボード、ランキング、レポートで参加者のデータを
                さまざまな角度から分析できます。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pages Guide */}
      <section className="help-section">
        <h2>各ページの使い方</h2>

        <div className="help-card">
          <h3><span className="help-icon">📊</span> ダッシュボード</h3>
          <p>アプリ全体のサマリーを表示します。</p>
          <ul>
            <li><strong>KPIカード</strong> — 総イベント数、総参加回数、ユニーク参加者数、平均参加者数</li>
            <li><strong>月別比較</strong> — 今月と先月のデータ比較</li>
            <li><strong>最近のイベント</strong> — 直近のイベントへのクイックアクセス</li>
          </ul>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">📂</span> ログ取込</h3>
          <p>VRChatのログファイルからイベントデータを取り込みます。</p>
          <ul>
            <li><strong>ファイルのインポート</strong> — <code>output_log_*.txt</code> ファイルをドラッグ＆ドロップ、またはファイル選択ボタンで選択</li>
            <li><strong>自動イベント作成</strong> — ワールドセッションごとにイベントが自動生成されます</li>
            <li><strong>重複チェック</strong> — 同じファイルの二重インポートを防止。必要なら「再インポート (force)」で上書き可能</li>
            <li><strong>インポート履歴</strong> — 過去のインポート記録を一覧表示。不要なものは ✕ ボタンで削除可能</li>
          </ul>
          <div className="help-tip">
            <strong>ログファイルの場所:</strong><br />
            <code>C:\Users\[ユーザー名]\AppData\LocalLow\VRChat\VRChat\</code> に
            <code>output_log_YYYY-MM-DD_HH-MM-SS.txt</code> として保存されています。
          </div>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">📅</span> イベント</h3>
          <p>イベントの一覧表示と詳細分析を行います。</p>
          <ul>
            <li><strong>イベント一覧</strong> — 日付順に表示。検索・ソートが可能</li>
            <li><strong>イベント作成</strong> — 右上の「+ 新しいイベント」でイベントを手動作成</li>
            <li><strong>イベント分析</strong> — イベントをクリックすると以下のタブが表示:
              <ul>
                <li><strong>概要</strong> — ピーク同時接続数、平均滞在時間、再入場率などの統計</li>
                <li><strong>グラフ</strong> — 同時接続タイムライン、時間帯別参加者数のグラフ</li>
                <li><strong>参加者</strong> — 参加者のJoin/Leave一覧テーブル</li>
                <li><strong>ランキング</strong> — イベント内の参加者ランキング</li>
              </ul>
            </li>
            <li><strong>エクスポート</strong> — XLSX（Excel）やCSV形式でデータをダウンロード</li>
          </ul>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">👥</span> ユーザー</h3>
          <p>ユーザー（参加者）の管理と分析を行います。</p>
          <ul>
            <li><strong>ユーザー一覧</strong> — 全参加者を表示。参加回数・滞在時間でソート可能</li>
            <li><strong>ユーザー詳細</strong> — クリックで個別の参加履歴を表示</li>
            <li><strong>タグ・メモ</strong> — ユーザーにタグやメモを追加して管理</li>
            <li><strong>スタッフフラグ</strong> — 運営スタッフをマークして区別</li>
          </ul>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">🏆</span> Rankings</h3>
          <p>参加者のランキングを表示します。</p>
          <ul>
            <li><strong>参加回数ランキング</strong> — 最も多く参加したユーザーの順位</li>
            <li><strong>滞在時間ランキング</strong> — 合計滞在時間が長いユーザーの順位</li>
            <li><strong>期間フィルター</strong> — 月別に絞り込んで集計可能</li>
            <li><strong>棒グラフ</strong> — 上位参加者をビジュアル表示</li>
          </ul>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">📋</span> Reports</h3>
          <p>月次・期間ごとのトレンドを分析します。</p>
          <ul>
            <li><strong>月別トレンド</strong> — イベント数、参加者数の推移グラフ</li>
            <li><strong>新規・リピーター率</strong> — 新規参加者とリピーターの比率</li>
            <li><strong>データテーブル</strong> — 各期間の詳細な数値データ</li>
          </ul>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">📺</span> YouTube</h3>
          <p>YouTube配信のチャットデータを取得・分析します。</p>
          <ul>
            <li><strong>配信の追加</strong> — YouTube動画URLを入力して配信を登録</li>
            <li><strong>チャット取得</strong> — 配信のチャットメッセージを一括取得</li>
            <li><strong>チャット統計</strong> — メッセージ数、ユニークチャッター数、トップチャッター</li>
            <li><strong>同時視聴者数</strong> — タイムラインで同時視聴者数の推移を表示</li>
            <li><strong>イベント連携</strong> — 配信をイベントに紐づけて横断分析</li>
          </ul>
          <div className="help-tip">
            <strong>YouTube API Key が必要です。</strong> Settings ページで Google Cloud Console から取得した
            YouTube Data API v3 のAPIキーを設定してください。
          </div>
        </div>

        <div className="help-card">
          <h3><span className="help-icon">⚙️</span> Settings</h3>
          <p>アプリケーションの設定を管理します。</p>
          <ul>
            <li><strong>YouTube API Key</strong> — YouTube機能を使用するためのAPIキー</li>
            <li><strong>ログディレクトリ</strong> — VRChatログファイルの場所を指定</li>
            <li><strong>自動監視</strong> — ログディレクトリの変更をリアルタイム監視</li>
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="help-section">
        <h2>よくある質問</h2>

        <div className="help-faq">
          <details>
            <summary>ログをインポートしたのにイベントが0件です</summary>
            <p>
              ログファイル内にJoin/Leaveイベントが含まれていない可能性があります。
              VRChatを起動してワールドに入った状態のログファイルをインポートしてください。
              ホームワールドのみのログにはプレイヤーイベントが記録されない場合があります。
            </p>
          </details>

          <details>
            <summary>同じイベントが重複して作成されます</summary>
            <p>
              同じログファイルを再インポートすると重複チェックが働きます。
              もし別のログファイルに同じワールドのセッションが含まれている場合は、
              各セッションごとに別々のイベントとして作成されます。
              不要なイベントは Events ページから削除できます。
            </p>
          </details>

          <details>
            <summary>インポートしたログを削除したい</summary>
            <p>
              Import Logs ページのインポート履歴で、削除したい記録の ✕ ボタンをクリックしてください。
              関連するプレイヤーイベントと、空になった自動作成イベントも一緒に削除されます。
            </p>
          </details>

          <details>
            <summary>ログファイルが見つかりません</summary>
            <p>
              VRChatのログは以下の場所に保存されています:<br />
              <code>C:\Users\[ユーザー名]\AppData\LocalLow\VRChat\VRChat\</code><br />
              <code>AppData</code> フォルダは隠しフォルダです。
              エクスプローラーのアドレスバーに直接パスを入力するか、
              表示設定で隠しファイルを表示してください。
            </p>
          </details>

          <details>
            <summary>YouTube機能が使えません</summary>
            <p>
              Settings ページで YouTube Data API v3 の API キーを設定してください。
              Google Cloud Console でプロジェクトを作成し、YouTube Data API v3 を有効にして
              APIキーを発行する必要があります。
            </p>
          </details>

          <details>
            <summary>データをバックアップするには？</summary>
            <p>
              データは <code>event-analytics/data/</code> フォルダ内の SQLite データベースファイルに
              保存されています。このファイルをコピーすればバックアップできます。
              また、Events ページから個別のイベントデータを XLSX/CSV でエクスポートすることも可能です。
            </p>
          </details>
        </div>
      </section>
    </div>
  )
}
