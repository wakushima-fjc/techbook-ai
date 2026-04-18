/**
 * PT/OT 臨床フィードバックエンジン（日本語版）
 * バイオメカニクスデータを解析し、専門的な臨床知見を提供します。
 */
export class ClinicalEngine {
    constructor() {
        // JARM 2022年改訂版 関節可動域基準値（参考値）
        this.ROM = {
            trunkFlexion:    45,  // 体幹前屈  JARM基準 45°
            neckFlexion:     60,  // 頸部前屈  JARM基準 60°
            kneeFlexionNorm: 150, // 膝屈曲    JARM基準 150°
            hipFlexionNorm:  125, // 股関節屈曲 JARM基準 125°
        };
        // REBA評価閾値
        this.rebaThreshold = {
            trunkCaution: 20,  // REBA score 2〜3境界
            trunkHigh:    45,  // JARM基準値超過
            kneeDeep:     120, // 膝深屈曲（REBA脚部スコア加算）
        };
    }
    generateReport(data) {
        const { history, setup, taskContext } = data;
        if (!history || history.length === 0) return [{ part: "データなし", priority: "情報", color:'#6b7280', comment: "分析データが不足しています。" }];
        const stats = this.analyzeStats(history);
        let feedback = [];
        // 0. 作業コンテキストからの事前リスク（入力があった場合）
        if (taskContext && taskContext.riskFactors.length > 0) {
            feedback.push({
                part: "作業特有のリスク（AI事前分析）",
                priority: "参考情報",
                color: '#60a5fa',
                comment: `この作業では以下のリスクが想定されます：${taskContext.riskFactors.join('・')}。` +
                         `特に注意すべき部位：${taskContext.bodySites.join('・')}。` +
                         `【推奨対策】${taskContext.precautions.join(' また、')}`
            });
        }
        // 1. 体幹（腰椎）の分析 - JARM基準: 前屈 45°
        if (stats.maxTrunk > this.rebaThreshold.trunkHigh) {
            feedback.push({
                part: "腰部・体幹",
                priority: "高リスク",
                color: '#ef4444',
                comment: `体幹の前傾角度が最大 ${stats.maxTrunk}° に達しており、JARM基準の前屈可動域（45°）を超過しています。この角度での作業は腰椎椎間板（特にL4/L5・L5/S1）への圧迫ストレスを急増させます。「股関節のヒンジ動作」を意識し、お尻を後ろに引くようにして体幹を立てることで、腰への負担を大幅に軽減できます。`
            });
        } else if (stats.maxTrunk > this.rebaThreshold.trunkCaution) {
            feedback.push({
                part: "腰部・体幹",
                priority: "要注意",
                color: '#f59e0b',
                comment: `体幹の前傾角度が最大 ${stats.maxTrunk}° に達しています。JARM基準の前屈可動域は45°ですが、REBAでは20°を超えると姿勢スコアが上がります（作業姿勢リスク増加）。長時間の継続は腰椎への慢性的なストレスにつながりますので、こまめな姿勢のリセットを心がけてください。`
            });
        } else {
            feedback.push({
                part: "腰部・体幹",
                priority: "良好",
                color: '#22c55e',
                comment: `体幹の前傾角度は最大 ${stats.maxTrunk}° と、JARM基準（前屈45°）・REBA安全範囲（0-20°）の両方において良好な範囲内を維持できています。この姿勢を継続することで、腰椎への慢性的な負担を最小化できます。`
            });
        }
        // 2. 膝関節の分析 - JARM基準: 屈曲 150°
        if (stats.maxKnee > this.rebaThreshold.kneeDeep) {
            feedback.push({
                part: "膝関節",
                priority: "中リスク",
                color: '#f59e0b',
                comment: `膝の屈曲角度が深く（最大 ${stats.maxKnee}°）、半月板・膝蓋軟骨への負担が増大しています。JARM基準の膝屈曲可動域は150°ですが、作業中に120°を超える深屈曲が繰り返されると、膝関節への累積ストレスが高まります。「つま先が膝より前に出ている」場合は特に注意が必要です。足裏全体に体重を分散し、臀筋（大臀筋・中臀筋）を積極的に使って立ち上がる動作を習得することが重要です。`
            });
        } else {
            feedback.push({
                part: "膝関節",
                priority: "良好",
                color: '#22c55e',
                comment: `膝関節の屈曲角度は適切な範囲内です（最大 ${stats.maxKnee}°、JARM基準150°）。この動作パターンは膝への長期的な負担を軽減し、職業病の予防につながります。`
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
