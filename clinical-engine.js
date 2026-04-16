export class ClinicalEngine {
      constructor() {
                this.expertThresholds = {
                              trunkFlexion: 20,
                              kneeFlexionDeep: 120,
                              shoulderAbduction: 90,
                              torqueSafeLimit: 50
                };
      }

    generateReport(data) {
              const { history, setup } = data;
              if (!history || history.length === 0) return "No data available.";

          const stats = this.analyzeStats(history);
              let feedback = [];

          if (stats.maxTrunk > this.expertThresholds.trunkFlexion) {
                        feedback.push({
                                          part: "Trunk",
                                          priority: "High",
                                          comment: `Trunk flexion reached ${stats.maxTrunk.toFixed(1)} degrees. This increases disc pressure. Try to keep your back more vertical.`
                        });
          }

          if (stats.maxKnee > this.expertThresholds.kneeFlexionDeep) {
                        feedback.push({
                                          part: "Knee",
                                          priority: "Medium",
                                          comment: `Deep knee flexion detected. Protect your joints by using your glutes more.`
                        });
          }

          const avgTorque = stats.avgTorque;
              if (avgTorque > this.expertThresholds.torqueSafeLimit) {
                            feedback.push({
                                              part: "Torque",
                                              priority: "High",
                                              comment: `Object is too far from your body. Keep it closer to reduce stress on your lower back.`
                            });
              }

          feedback.push({
                        part: "Skill Gap",
                        priority: "Info",
                        comment: `Keep your center of gravity low and stable like an expert.`
          });

          return feedback;
    }

    analyzeStats(history) {
              const trunkScores = history.map(h => h.trunk || 0);
              const kneeScores = history.map(h => h.knee || 0);
              const torqueScores = history.map(h => h.torque || 0);

          return {
                        maxTrunk: Math.max(...trunkScores),
                        maxKnee: Math.max(...kneeScores),
                        avgTorque: torqueScores.reduce((a,b)=>a+b, 0) / torqueScores.length,
                        peakTorque: Math.max(...torqueScores)
          };
    }
}
