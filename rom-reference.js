/**
 * rom-reference.js
 * 日本リハビリテーション医学会（JARM）2022年改訂版
 * 関節可動域（ROM）基準値データ
 */

export const ROM_REFERENCE = {
    cervical: {
        name: '頸部',
        basicAxis:  '肩峰を通る床への垂直線',
        motionAxis: '外耳孔と頭頂を結ぶ線',
        flexion:        { max: 60,  label: '前屈' },
        extension:      { max: 50,  label: '後屈' },
        lateralBending: { max: 50,  label: '側屈' },
        rotation:       { max: 60,  label: '回旋' },
    },
    trunk: {
        name: '胸腰部・体幹',
        basicAxis:  '仙骨後面（床への垂直線）',
        motionAxis: '第1胸椎棘突起と第5腰椎棘突起を結ぶ線',
        flexion:        { max: 45,  label: '前屈' },
        extension:      { max: 30,  label: '後屈' },
        lateralBending: { max: 50,  label: '側屈' },
        rotation:       { max: 40,  label: '回旋' },
    },
    shoulder: {
        name: '肩関節',
        basicAxis:  '肩峰を通る床への垂直線',
        motionAxis: '上腕骨（肩峰→肘関節中心）',
        flexion:    { max: 180, label: '屈曲（前方挙上）' },
        extension:  { max: 50,  label: '伸展（後方挙上）' },
        abduction:  { max: 180, label: '外転' },
    },
    elbow: {
        name: '肘関節',
        basicAxis:  '上腕骨（肩→肘）',
        motionAxis: '橈骨（肘→手首）',
        flexion:    { max: 145, label: '屈曲' },
        extension:  { max: 5,   label: '伸展' },
    },
    wrist: {
        name: '手関節',
        basicAxis:  '橈骨（肘→手首）',
        motionAxis: '第2中手骨（手首→指先方向）',
        flexion:    { max: 90,  label: '掌屈' },
        extension:  { max: 70,  label: '背屈' },
    },
    hip: {
        name: '股関節',
        basicAxis:  '体幹と平行な線（下方鉛直）',
        motionAxis: '大腿骨（股関節中心→膝関節中心）',
        flexion:    { max: 125, label: '屈曲' },
        extension:  { max: 15,  label: '伸展' },
    },
    knee: {
        name: '膝関節',
        basicAxis:  '大腿骨（股→膝）',
        motionAxis: '腓骨（膝→外果）',
        flexion:    { max: 130, label: '屈曲' },  // JARM 2022年改訂値
        extension:  { max: 0,   label: '伸展' },
    },
};

export const ROM_WARNING_RATIO = 0.90;  // 90% で警告（🟡黄）
export const ROM_ALERT_RATIO   = 1.00;  // 100% で超過（🔴赤）

export function getROMStatus(joint, direction, measuredDeg) {
    const ref = ROM_REFERENCE[joint]?.[direction];
    if (!ref) return { status:'unknown', ratio:0, label:'—', color:'#6b7280', bg:'rgba(107,114,128,0.1)' };
    if (ref.max === 0) return { status:'ok', ratio:0, label:`${measuredDeg}°`, color:'#22c55e', bg:'rgba(34,197,94,0.1)' };

    const ratio = measuredDeg / ref.max;
    if (ratio >= ROM_ALERT_RATIO)   return { status:'exceeded', ratio, label:`⚠ 超過 ${measuredDeg}°/${ref.max}°`, color:'#ef4444', bg:'rgba(239,68,68,0.15)',   pulse:true  };
    if (ratio >= ROM_WARNING_RATIO) return { status:'warning',  ratio, label:`⚡ ${measuredDeg}°/${ref.max}°`,     color:'#f59e0b', bg:'rgba(245,158,11,0.15)', pulse:false };
    return                                 { status:'ok',       ratio, label:`${measuredDeg}°/${ref.max}°`,        color:'#22c55e', bg:'rgba(34,197,94,0.1)',   pulse:false };
}

export function checkAllROM(angles) {
    return [
        { name:'体幹前屈',   ...getROMStatus('trunk',    'flexion', angles.trunk)     },
        { name:'頸部前屈',   ...getROMStatus('cervical', 'flexion', angles.neck)      },
        { name:'肩関節屈曲', ...getROMStatus('shoulder', 'flexion', angles.shoulderR) },
        { name:'肘関節屈曲', ...getROMStatus('elbow',    'flexion', angles.elbowR)    },
        { name:'股関節屈曲', ...getROMStatus('hip',      'flexion', angles.hipR)      },
        { name:'膝関節屈曲', ...getROMStatus('knee',     'flexion', angles.kneeR)     },
    ];
}
