export class REBAEngine {
      constructor() {
                this.tableA = [
                              [[1, 2, 3, 4], [2, 3, 4, 5], [2, 4, 5, 6]],
                              [[2, 3, 4, 5], [3, 4, 5, 6], [4, 5, 6, 7]],
                              [[2, 4, 5, 6], [4, 5, 6, 7], [5, 6, 7, 8]],
                              [[4, 5, 6, 7], [5, 6, 7, 8], [6, 7, 8, 9]],
                              [[6, 7, 8, 9], [7, 8, 9, 9], [8, 9, 9, 9]]
                          ];
                this.tableB = [
                              [[1, 2, 2], [1, 2, 3]],
                              [[1, 2, 3], [2, 3, 4]],
                              [[3, 4, 4], [3, 5, 5]],
                              [[4, 5, 5], [5, 6, 7]],
                              [[6, 7, 8], [7, 8, 9]],
                              [[7, 8, 9], [8, 9, 9]]
                          ];
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

    getScoreA(neck, trunk, leg, load, suddenForce) {
              const n = Math.max(1, Math.min(3, neck));
              const t = Math.max(1, Math.min(5, trunk));
              const l = Math.max(1, Math.min(4, leg));
              const postureA = this.tableA[t-1][n-1][l-1];
              let loadScore = 0;
              if (load >= 5 && load <= 10) loadScore = 1;
              else if (load > 10) loadScore = 2;
              if (suddenForce) loadScore += 1;
              return postureA + loadScore;
    }

    getScoreB(upperArm, lowerArm, wrist, coupling) {
              const ua = Math.max(1, Math.min(6, upperArm));
              const la = Math.max(1, Math.min(2, lowerArm));
              const w = Math.max(1, Math.min(3, wrist));
              const postureB = this.tableB[ua-1][la-1][w-1];
              return postureB + coupling;
    }

    getFinalScore(scoreA, scoreB, activityScore) {
              const sA = Math.max(1, Math.min(12, scoreA));
              const sB = Math.max(1, Math.min(12, scoreB));
              const scoreC = this.tableC[sA-1][sB-1];
              return Math.min(15, scoreC + activityScore);
    }

    getActionLevel(score) {
              if (score === 1) return { level: 0, risk: "Minimal Risk", action: "None", color: "#e2e8f0" };
              if (score <= 3) return { level: 1, risk: "Low Risk", action: "May need check", color: "#cbd5e1" };
              if (score <= 7) return { level: 2, risk: "Medium Risk", action: "Needs check", color: "#94a3b8" };
              if (score <= 10) return { level: 3, risk: "High Risk", action: "Needs fast action", color: "#475569" };
              return { level: 4, risk: "Very High Risk", action: "Immediate action", color: "#0f172a" };
    }
}
