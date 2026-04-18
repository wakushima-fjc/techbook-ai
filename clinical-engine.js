

User uploaded media 1
User uploaded media 2
User uploaded media 3
User uploaded media 4
できました。レポートは日本語で出力してください。
また部位の選択がうまくできていません。ベンチマークのスプライザモーション（アプリ）を参考に、ブラッシュアップしたいです。
それと速度解析や軌跡のオンオフなどができないようです。
作成したプランに基づき、まずは clinical-engine.js の日本語化 と、index.html での部位選択UIのデザイン刷新 から着手します。

プランの内容に問題なければ、その旨お知らせください。すぐに作業を開始します。

Implementation Plan
Proceeded with
Implementation Plan
Manually proceeded.

Asks for Review
続けて
3ファイルすべての更新が完了しました！

今回の改善まとめ
改善項目	内容
レポート日本語化	体幹・膝・荷重・総合リスクを日本語でアドバイス。リスクレベルに応じて色分け表示
部位選択UI刷新	SplaMotion風のリアルな骨格シルエットSVG。タップ判定を大きくし誤操作を防止
軌跡のON/OFF	正しくボタンに接続。選択した関節の動きが緑のグラデーションの尾で表示される
速度解析の切替	「角度解析」「速度解析」ボタンで即座に切替。追跡部位の速度をcm/s単位で表示
デザインの刷新	全体をダークモード＋グラスモーフィズムに刷新。白バックから引き締まったプロ仕様に
二重チャート	REBAスコアと体幹角度を同時にリアルタイム表示
GitHubへのアップロードお願い
以下の 3ファイル をアップロード（上書き）してください：

index.html
main.js
clinical-engine.js
アップロード後、サイトを再読み込みしてお試しください！

3
clinical-engine.js
index.html
main.js








clinical-engine.js



/**
 * PT/OT 臨床フィードバックエンジン（日本語版）
 * バイオメカニクスデータを解析し、専門的な臨床知見を提供します。
 */
export class ClinicalEngine {
    constructor() {
        this.expertThresholds = {
            trunkFlexion: 20,
            kneeFlexionDeep: 120,
            torqueSafeLimit: 50
        };
    }
    generateReport(data) {
        const { history, setup } = data;
        if (!history || history.length === 0) return [{ part: "データなし", priority: "情報", comment: "分析データが不足しています。" }];
        const stats = this.analyzeStats(history);
        let feedback = [];
        // 1. 体幹（腰椎）の分析
        if (stats.maxTrunk > this.expertThresholds.trunkFlexion) {
            const severity = stats.maxTrunk > 60 ? "高" : stats.maxTrunk > 40 ? "中" : "低";
            feedback.push({
                part: "腰部・体幹",
                priority: severity + "リスク",
                color: stats.maxTrunk > 60 ? '#ef4444' : '#f59e0b',
                comment: `体幹の前傾角度が最大 ${stats.maxTrunk.toFixed(1)}° に達しています。理学療法の観点では、20°を超える前傾姿勢での作業は腰椎椎間板（特にL4/L5・L5/S1）への圧迫ストレスを急増させます。「股関節のヒンジ動作」を意識し、お尻を後ろに引くようにして体幹を立てることで、腰への負担を大幅に軽減できます。`
            });
        } else {
            feedback.push({
                part: "腰部・体幹",
                priority: "良好",
                color: '#22c55e',
                comment: `体幹の前傾角度は許容範囲内（最大 ${stats.maxTrunk.toFixed(1)}°）を維持できています。この姿勢を継続することで、腰椎への慢性的な負担を最小化できます。`
            });
        }
        // 2. 膝関節の分析
        if (stats.maxKnee > this.expertThresholds.kneeFlexionDeep) {
            feedback.push({
                part: "膝関節",
                priority: "中リスク",
                color: '#f59e0b',
                comment: `膝の屈曲角度が深く（最大 ${stats.maxKnee.toFixed(1)}°）、半月板・膝蓋軟骨への負担が増大しています。「つま先が膝より前に出ている」場合は特に注意が必要です。足裏全体に体重を分散し、臀筋（大臀筋・中臀筋）を積極的に使って立ち上がる動作を習得することが重要です。`
            });
        } else {
            feedback.push({
                part: "膝関節",
                priority: "良好",
                color: '#22c55e',
                comment: `膝関節の屈曲角度は適切な範囲内です（最大 ${stats.maxKnee.toFixed(1)}°）。この動作パターンは膝への長期的な負担を軽減し、職業病の予防につながります。`
            });
        }
        // 3. 荷重・負荷の分析
        if (setup && setup.load > 7) {
            feedback.push({
                part: "荷重管理",
                priority: "高リスク",
                color: '#ef4444',
                comment: `10kg以上の重量物を扱っており、筋骨格系への負担が顕著です。荷物を体に密着させて扱うことで、腰部モーメントアームを短縮し、腰への力学的ストレスを30%以上軽減できます。複数人での作業分担や、補助器具の活用を検討してください。`
            });
        }
        // 4. 動作の安定性（REBAスコア統計に基づく）
        const avgScore = stats.avgScore;
        const maxScore = stats.maxScore;
        if (maxScore >= 8) {
            feedback.push({
                part: "総合リスク評価",
                priority: "要改善",
                color: '#ef4444',
                comment: `ピークREBAスコアが ${maxScore} に達しており、早急な動作改善が必要なレベルです（スコア8以上＝レベル3「高リスク」）。熟練技術者は重心を低く安定させ、体幹のブレを最小化することで、この数値を4以下に抑えています。継続的な動作訓練と定期的な評価が推奨されます。`
            });
        } else if (maxScore >= 4) {
            feedback.push({
                part: "総合リスク評価",
                priority: "要注意",
                color: '#f59e0b',
                comment: `平均REBAスコアは ${avgScore.toFixed(1)}（ピーク: ${maxScore}）です。作業内容によっては改善の余地があります。動作の「溜め」と体幹の安定を意識し、繰り返し作業における累積負荷の低減を心がけてください。`
            });
        } else {
            feedback.push({
                part: "総合リスク評価",
                priority: "良好",
                color: '#22c55e',
                comment: `平均REBAスコアは ${avgScore.toFixed(1)}（ピーク: ${maxScore}）であり、全体的に安全な動作パターンが確認できます。この動作を後進に伝える「お手本映像」として記録・活用することをお勧めします。`
            });
        }
        // 5. 技術承継の観点
        feedback.push({
            part: "技術承継アドバイス",
            priority: "情報",
            color: '#3b82f6',
            comment: `記録されたデータは、職場の後継者育成に活用できます。「こうすれば腰が楽になる」という熟練者の暗黙知を数値化し、若手との比較分析を行うことで、安全な作業技術の体系的な継承が可能になります。`
        });
        return feedback;
    }
    analyzeStats(history) {
        const trunkScores = history.map(h => h.trunk || 0);
        const kneeScores  = history.map(h => h.knee  || 0);
        const scores      = history.map(h => h.score || 1);
        return {
            maxTrunk:  Math.max(...trunkScores),
            maxKnee:   Math.max(...kneeScores),
            avgScore:  scores.reduce((a, b) => a + b, 0) / scores.length,
            maxScore:  Math.max(...scores)
        };
    }
}
