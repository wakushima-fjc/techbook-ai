/**
 * REBA (Rapid Entire Body Assessment) Scoring Engine
 * 日本リハビリテーション医学会 (JARM) 2022年改訂版 ROM 基準値を参照
 *
 * ■ JARM 基準関節可動域 (参考値)
 *   体幹: 前屈 45°/ 後屈 30°/ 側屈 50°/ 回旋 40°
 *   頸部: 前屈 60°/ 後屈 50°/ 側屈 50°/ 回旋 60°
 *   股関節: 屈曲 125°/ 伸展 15°/ 外転 45°/ 内転 20°
 *   膝関節: 屈曲 150°/ 伸展 0°
 *   足関節: 背屈 20°/ 底屈 45°
 *   肩関節: 屈曲 180°/ 伸展 50°/ 外転 180°
 *   肘関節: 屈曲 145°/ 伸展 5°
 */
export class REBAEngine {
    constructor() {
        // JARM準拠の可動域基準値 (度)
        this.ROM = {
            trunk:    { flexion: 45,  extension: 30, lateralFlexion: 50, rotation: 40 },
            neck:     { flexion: 60,  extension: 50, lateralFlexion: 50, rotation: 60 },
            hip:      { flexion: 125, extension: 15, abduction: 45,      adduction: 20 },
            knee:     { flexion: 150, extension: 0 },
            ankle:    { dorsalFlexion: 20, plantarFlexion: 45 },
            shoulder: { flexion: 180, extension: 50, abduction: 180 },
            elbow:    { flexion: 145, extension: 5 }
        };
        // REBA Table A: [体幹スコア 1-5][頸部スコア 1-3][脚部スコア 1-4]
        this.tableA = [
            [[1, 2, 3, 4], [2, 3, 4, 5], [2, 4, 5, 6]], // Trunk 1
            [[2, 3, 4, 5], [3, 4, 5, 6], [4, 5, 6, 7]], // Trunk 2
            [[2, 4, 5, 6], [4, 5, 6, 7], [5, 6, 7, 8]], // Trunk 3
            [[4, 5, 6, 7], [5, 6, 7, 8], [6, 7, 8, 9]], // Trunk 4
            [[6, 7, 8, 9], [7, 8, 9, 9], [8, 9, 9, 9]]  // Trunk 5
        ];
        // REBA Table B: [上腕スコア 1-6][前腕スコア 1-2][手首スコア 1-3]
        this.tableB = [
            [[1, 2, 2], [1, 2, 3]],
            [[1, 2, 3], [2, 3, 4]],
            [[3, 4, 4], [3, 5, 5]],
            [[4, 5, 5], [5, 6, 7]],
            [[6, 7, 8], [7, 8, 9]],
            [[7, 8, 9], [8, 9, 9]]
        ];
        // REBA Table C: [Score A 1-12][Score B 1-12]
        this.tableC = [
            [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
            [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
            [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
            [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
            [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 10],
            [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 11],
            [7, 7, 7, 8, 9, 9, 10, 10, 11, 11, 11, 12],
            [8, 8, 8, 9, 10, 10, 11, 11, 12, 12, 12, 12],
            [9, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 12],
            [10, 10, 10, 11, 11, 11, 12, 12, 12, 12, 12, 12],
            [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
            [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]
        ];
    }
    /**
     * 体幹角度 → REBA 体幹スコア (1-5)
     * REBA基準: 1=0-10°, 2=10-20°, 3=20-60°, 4=>60°, +1で側屈または後屈
     */
    getTrunkScore(flexionDeg) {
        const angle = Math.max(0, Math.min(90, flexionDeg)); // 0-90°にクランプ
        if (angle <= 10) return 1;
        if (angle <= 20) return 2;
        if (angle <= 60) return 3;
        return 4;
    }
    /**
     * 頸部角度 → REBA 頸部スコア (1-3)
     * REBA基準: 1=0-20°, 2=>20°, +1で後屈または回旋
     */
    getNeckScore(flexionDeg) {
        return flexionDeg <= 20 ? 1 : 2;
    }
    /**
     * 膝屈曲→ REBA脚部スコア (1-4)
     * REBA基準: 1=支持両脚, 2=支持片脚/不安定, +1=膝屈曲30-60°, +2=膝屈曲>60°
     */
    getLegScore(kneeFlexionDeg) {
        if (kneeFlexionDeg <= 30) return 1;
        if (kneeFlexionDeg <= 60) return 2;
        return 3;
    }
    /**
     * Group A Score Calculation
     */
    getScoreA(neck, trunk, leg, load, suddenForce) {
        const n = Math.max(1, Math.min(3, neck));
        const t = Math.max(1, Math.min(5, trunk));
        const l = Math.max(1, Math.min(4, leg));
        const postureA = this.tableA[t-1][n-1][l-1];
        let loadScore = load >= 10 ? 2 : load >= 5 ? 1 : 0;
        if (suddenForce) loadScore += 1;
        return postureA + loadScore;
    }
    /**
     * Group B Score Calculation
     */
    getScoreB(upperArm, lowerArm, wrist, coupling) {
        const ua = Math.max(1, Math.min(6, upperArm));
        const la = Math.max(1, Math.min(2, lowerArm));
        const w  = Math.max(1, Math.min(3, wrist));
        return this.tableB[ua-1][la-1][w-1] + coupling;
    }
    /**
     * Final REBA Score
     */
    getFinalScore(scoreA, scoreB, activityScore = 0) {
        const sA = Math.max(1, Math.min(12, scoreA));
        const sB = Math.max(1, Math.min(12, scoreB));
        return Math.min(15, this.tableC[sA-1][sB-1] + activityScore);
    }
    /**
     * 角度から直接 REBAスコアを簡易計算（カメラ映像用）
     */
    calcFromAngles({ trunkFlex, neckFlex, kneeFlexion, load, suddenForce, coupling }) {
        const trunkScore = this.getTrunkScore(trunkFlex);
        const neckScore  = this.getNeckScore(neckFlex);
        const legScore   = this.getLegScore(kneeFlexion);
        const scoreA = this.getScoreA(neckScore, trunkScore, legScore, load, suddenForce);
        const scoreB = this.getScoreB(2, 1, 1, coupling); // 上腕推定
        return this.getFinalScore(scoreA, scoreB);
    }
    /**
     * JARM基準値との比較
     * @returns {{ joint, measured, norm, ratio, status }}
     */
    compareWithROM(joint, measuredDeg, direction = 'flexion') {
        const norm = this.ROM[joint]?.[direction];
        if (!norm) return null;
        const ratio  = Math.min(measuredDeg / norm, 1.0);
        const status = ratio >= 0.9 ? '正常範囲' : ratio >= 0.7 ? '軽度制限' : ratio >= 0.5 ? '中等度制限' : '重度制限';
        return { joint, direction, measured: measuredDeg, norm, ratio, status };
    }
    /**
     * アクションレベル + 色
     */
    getActionLevel(score) {
        if (score <= 1)  return { level: 0, risk: '問題なし',           action: '改善不要',               color: '#22c55e' };
        if (score <= 3)  return { level: 1, risk: '低リスク',           action: '改善が望ましい',           color: '#84cc16' };
        if (score <= 7)  return { level: 2, risk: '中程度のリスク',     action: '調査と改善が必要',         color: '#f59e0b' };
        if (score <= 10) return { level: 3, risk: '高リスク',           action: '早急な調査と改善が必要', color: '#ef4444' };
        return               { level: 4, risk: '非常に高いリスク',   action: '直ちに改善が必要',         color: '#7c3aed' };
    }
}
