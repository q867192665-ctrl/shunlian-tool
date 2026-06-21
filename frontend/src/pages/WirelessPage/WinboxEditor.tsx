import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Input, Select, Checkbox, Radio, AutoComplete, Modal } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import styles from './WinboxEditor.module.css';

const { TextArea } = Input;
const { Option } = Select;

interface WirelessInterface {
  name: string;
  type?: string;
  mac_address?: string;
  ssid?: string;
  band?: string;
  frequency?: string;
  'channel-width'?: string;
  'wireless-protocol'?: string;
  mode?: string;
  running?: boolean;
  disabled?: boolean;
  comment?: string;
  '.id'?: string;
  [key: string]: any;
}

interface SecurityProfileData {
  name: string;
  mode?: string;
  authentication_types?: string;
  unicast_ciphers?: string;
  group_ciphers?: string;
  authentication?: string;
  cipher?: string;
  password?: string;
}

interface WinboxEditorProps {
  interface: WirelessInterface;
  onChange: (iface: WirelessInterface) => void;
  routerIp?: string;
  securityProfiles?: SecurityProfileData[];
  nlevel?: number | null;
}

const tabs = [
  { key: 'general', label: '常规' },
  { key: 'wireless', label: '无线' },
  { key: 'datarates', label: '数据速率' },
  { key: 'advanced', label: '高级' },
  { key: 'ht', label: 'HT' },
  { key: 'mcs', label: 'MCS速率' },
  { key: 'wds', label: 'WDS' },
  { key: 'nstreme', label: 'Nstreme' },
  { key: 'txpower', label: '发射功率' },
];

const frequencyOptions24G = [
  { value: '2412', label: '2412 MHz (信道 1)', channel: 1 },
  { value: '2417', label: '2417 MHz (信道 2)', channel: 2 },
  { value: '2422', label: '2422 MHz (信道 3)', channel: 3 },
  { value: '2427', label: '2427 MHz (信道 4)', channel: 4 },
  { value: '2432', label: '2432 MHz (信道 5)', channel: 5 },
  { value: '2437', label: '2437 MHz (信道 6)', channel: 6 },
  { value: '2442', label: '2442 MHz (信道 7)', channel: 7 },
  { value: '2447', label: '2447 MHz (信道 8)', channel: 8 },
  { value: '2452', label: '2452 MHz (信道 9)', channel: 9 },
  { value: '2457', label: '2457 MHz (信道 10)', channel: 10 },
  { value: '2462', label: '2462 MHz (信道 11)', channel: 11 },
  { value: '2467', label: '2467 MHz (信道 12)', channel: 12 },
  { value: '2472', label: '2472 MHz (信道 13)', channel: 13 },
  { value: '2484', label: '2484 MHz (信道 14)', channel: 14 },
];

const frequencyOptions5G = [
  { value: '5180', label: '5180 MHz (信道 36)', channel: 36 },
  { value: '5200', label: '5200 MHz (信道 40)', channel: 40 },
  { value: '5220', label: '5220 MHz (信道 44)', channel: 44 },
  { value: '5240', label: '5240 MHz (信道 48)', channel: 48 },
  { value: '5260', label: '5260 MHz (信道 52)', channel: 52 },
  { value: '5280', label: '5280 MHz (信道 56)', channel: 56 },
  { value: '5300', label: '5300 MHz (信道 60)', channel: 60 },
  { value: '5320', label: '5320 MHz (信道 64)', channel: 64 },
  { value: '5500', label: '5500 MHz (信道 100)', channel: 100 },
  { value: '5520', label: '5520 MHz (信道 104)', channel: 104 },
  { value: '5540', label: '5540 MHz (信道 108)', channel: 108 },
  { value: '5560', label: '5560 MHz (信道 112)', channel: 112 },
  { value: '5580', label: '5580 MHz (信道 116)', channel: 116 },
  { value: '5600', label: '5600 MHz (信道 120)', channel: 120 },
  { value: '5620', label: '5620 MHz (信道 124)', channel: 124 },
  { value: '5640', label: '5640 MHz (信道 128)', channel: 128 },
  { value: '5660', label: '5660 MHz (信道 132)', channel: 132 },
  { value: '5680', label: '5680 MHz (信道 136)', channel: 136 },
  { value: '5700', label: '5700 MHz (信道 140)', channel: 140 },
  { value: '5720', label: '5720 MHz (信道 144)', channel: 144 },
  { value: '5745', label: '5745 MHz (信道 149)', channel: 149 },
  { value: '5765', label: '5765 MHz (信道 153)', channel: 153 },
  { value: '5785', label: '5785 MHz (信道 157)', channel: 157 },
  { value: '5805', label: '5805 MHz (信道 161)', channel: 161 },
  { value: '5825', label: '5825 MHz (信道 165)', channel: 165 },
];

// 超级信道模式：5.8G 频率范围 4920-6100MHz，步长 5MHz
// 标准信道（5180/5200/5220 等）标记为 isStandard，前端加粗显示
const superchannelOptions5G: { value: string; label: string; channel: number; isStandard: boolean }[] = (() => {
  const options: { value: string; label: string; channel: number; isStandard: boolean }[] = [];
  for (let freq = 4920; freq <= 6100; freq += 5) {
    const standard = frequencyOptions5G.find(f => f.value === String(freq));
    options.push({
      value: String(freq),
      label: standard ? standard.label : `${freq} MHz`,
      channel: standard ? standard.channel : -1,
      isStandard: !!standard,
    });
  }
  return options;
})();

const countryList = [
  { value: 'no_country_set', label: '默认' },
  { value: 'albania', label: '阿尔巴尼亚 (AL)' },
  { value: 'algeria', label: '阿尔及利亚 (DZ)' },
  { value: 'andorra', label: '安道尔 (AD)' },
  { value: 'argentina', label: '阿根廷 (AR)' },
  { value: 'armenia', label: '亚美尼亚 (AM)' },
  { value: 'australia', label: '澳大利亚 (AU)' },
  { value: 'austria', label: '奥地利 (AT)' },
  { value: 'azerbaijan', label: '阿塞拜疆 (AZ)' },
  { value: 'bahrain', label: '巴林 (BH)' },
  { value: 'belarus', label: '白俄罗斯 (BY)' },
  { value: 'belgium', label: '比利时 (BE)' },
  { value: 'bosnia and herzegovina', label: '波黑 (BA)' },
  { value: 'brazil', label: '巴西 (BR)' },
  { value: 'brunei', label: '文莱 (BN)' },
  { value: 'bulgaria', label: '保加利亚 (BG)' },
  { value: 'canada', label: '加拿大 (CA)' },
  { value: 'chile', label: '智利 (CL)' },
  { value: 'china', label: '中国 (CN)' },
  { value: 'colombia', label: '哥伦比亚 (CO)' },
  { value: 'costa rica', label: '哥斯达黎加 (CR)' },
  { value: 'croatia', label: '克罗地亚 (HR)' },
  { value: 'cyprus', label: '塞浦路斯 (CY)' },
  { value: 'czech republic', label: '捷克 (CZ)' },
  { value: 'denmark', label: '丹麦 (DK)' },
  { value: 'dominican republic', label: '多米尼加 (DO)' },
  { value: 'ecuador', label: '厄瓜多尔 (EC)' },
  { value: 'egypt', label: '埃及 (EG)' },
  { value: 'estonia', label: '爱沙尼亚 (EE)' },
  { value: 'finland', label: '芬兰 (FI)' },
  { value: 'france', label: '法国 (FR)' },
  { value: 'georgia', label: '格鲁吉亚 (GE)' },
  { value: 'germany', label: '德国 (DE)' },
  { value: 'greece', label: '希腊 (GR)' },
  { value: 'guatemala', label: '危地马拉 (GT)' },
  { value: 'honduras', label: '洪都拉斯 (HN)' },
  { value: 'hong kong', label: '香港 (HK)' },
  { value: 'hungary', label: '匈牙利 (HU)' },
  { value: 'iceland', label: '冰岛 (IS)' },
  { value: 'india', label: '印度 (IN)' },
  { value: 'indonesia', label: '印度尼西亚 (ID)' },
  { value: 'iran', label: '伊朗 (IR)' },
  { value: 'iraq', label: '伊拉克 (IQ)' },
  { value: 'ireland', label: '爱尔兰 (IE)' },
  { value: 'israel', label: '以色列 (IL)' },
  { value: 'italy', label: '意大利 (IT)' },
  { value: 'jamaica', label: '牙买加 (JM)' },
  { value: 'japan', label: '日本 (JP)' },
  { value: 'jordan', label: '约旦 (JO)' },
  { value: 'kazakhstan', label: '哈萨克斯坦 (KZ)' },
  { value: 'kenya', label: '肯尼亚 (KE)' },
  { value: 'korea, republic of', label: '韩国 (KR)' },
  { value: 'kuwait', label: '科威特 (KW)' },
  { value: 'latvia', label: '拉脱维亚 (LV)' },
  { value: 'lebanon', label: '黎巴嫩 (LB)' },
  { value: 'libya', label: '利比亚 (LY)' },
  { value: 'liechtenstein', label: '列支敦士登 (LI)' },
  { value: 'lithuania', label: '立陶宛 (LT)' },
  { value: 'luxembourg', label: '卢森堡 (LU)' },
  { value: 'macau', label: '澳门 (MO)' },
  { value: 'macedonia', label: '北马其顿 (MK)' },
  { value: 'malaysia', label: '马来西亚 (MY)' },
  { value: 'malta', label: '马耳他 (MT)' },
  { value: 'mexico', label: '墨西哥 (MX)' },
  { value: 'moldova', label: '摩尔多瓦 (MD)' },
  { value: 'monaco', label: '摩纳哥 (MC)' },
  { value: 'montenegro', label: '黑山 (ME)' },
  { value: 'morocco', label: '摩洛哥 (MA)' },
  { value: 'nepal', label: '尼泊尔 (NP)' },
  { value: 'netherlands', label: '荷兰 (NL)' },
  { value: 'new zealand', label: '新西兰 (NZ)' },
  { value: 'nicaragua', label: '尼加拉瓜 (NI)' },
  { value: 'norway', label: '挪威 (NO)' },
  { value: 'oman', label: '阿曼 (OM)' },
  { value: 'pakistan', label: '巴基斯坦 (PK)' },
  { value: 'panama', label: '巴拿马 (PA)' },
  { value: 'paraguay', label: '巴拉圭 (PY)' },
  { value: 'peru', label: '秘鲁 (PE)' },
  { value: 'philippines', label: '菲律宾 (PH)' },
  { value: 'poland', label: '波兰 (PL)' },
  { value: 'portugal', label: '葡萄牙 (PT)' },
  { value: 'qatar', label: '卡塔尔 (QA)' },
  { value: 'romania', label: '罗马尼亚 (RO)' },
  { value: 'russian federation', label: '俄罗斯 (RU)' },
  { value: 'saudi arabia', label: '沙特阿拉伯 (SA)' },
  { value: 'serbia', label: '塞尔维亚 (RS)' },
  { value: 'singapore', label: '新加坡 (SG)' },
  { value: 'slovakia', label: '斯洛伐克 (SK)' },
  { value: 'slovenia', label: '斯洛文尼亚 (SI)' },
  { value: 'south africa', label: '南非 (ZA)' },
  { value: 'spain', label: '西班牙 (ES)' },
  { value: 'sri lanka', label: '斯里兰卡 (LK)' },
  { value: 'sweden', label: '瑞典 (SE)' },
  { value: 'switzerland', label: '瑞士 (CH)' },
  { value: 'syria', label: '叙利亚 (SY)' },
  { value: 'taiwan', label: '台湾 (TW)' },
  { value: 'thailand', label: '泰国 (TH)' },
  { value: 'trinidad and tobago', label: '特立尼达和多巴哥 (TT)' },
  { value: 'tunisia', label: '突尼斯 (TN)' },
  { value: 'turkey', label: '土耳其 (TR)' },
  { value: 'ukraine', label: '乌克兰 (UA)' },
  { value: 'united arab emirates', label: '阿联酋 (AE)' },
  { value: 'united kingdom', label: '英国 (GB)' },
  { value: 'united states', label: '美国 (US)' },
  { value: 'uruguay', label: '乌拉圭 (UY)' },
  { value: 'uzbekistan', label: '乌兹别克斯坦 (UZ)' },
  { value: 'venezuela', label: '委内瑞拉 (VE)' },
  { value: 'vietnam', label: '越南 (VN)' },
  { value: 'yemen', label: '也门 (YE)' },
  { value: 'zimbabwe', label: '津巴布韦 (ZW)' },
];

const countryFrequencyRules: { [key: string]: { channels24G: number[], channels5G: number[] } } = {
  'china': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'united states': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'japan': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    channels5G: [36, 40, 44, 48],
  },
  'united kingdom': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'germany': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'australia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  },
  'canada': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'korea, republic of': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161],
  },
  'india': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'brazil': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  },
  'russian federation': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64],
  },
  'singapore': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  },
  'taiwan': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161, 165],
  },
  'thailand': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'malaysia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'indonesia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 149, 153, 157, 161, 165],
  },
  'philippines': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'vietnam': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64],
  },
  'france': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'italy': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'spain': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'netherlands': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'sweden': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'norway': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'denmark': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'finland': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'poland': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'switzerland': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'austria': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'belgium': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'portugal': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'greece': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'turkey': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64],
  },
  'israel': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'south africa': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'mexico': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  },
  'argentina': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'chile': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'colombia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'peru': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'new zealand': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  },
  'hong kong': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'macau': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'saudi arabia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'united arab emirates': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'qatar': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'kuwait': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48],
  },
  'bahrain': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'oman': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'egypt': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48],
  },
  'morocco': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48],
  },
  'kenya': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'pakistan': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'sri lanka': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 149, 153, 157, 161, 165],
  },
  'nepal': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48],
  },
  'ukraine': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64],
  },
  'romania': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'hungary': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'czech republic': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'slovakia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'bulgaria': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'croatia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'serbia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48],
  },
  'slovenia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'estonia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'latvia': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'lithuania': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'ireland': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
  'iceland': {
    channels24G: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    channels5G: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144],
  },
};

export const WinboxEditor: React.FC<WinboxEditorProps> = ({ interface: iface, onChange, routerIp, securityProfiles, nlevel }) => {
  const [activeTab, setActiveTab] = useState('wireless');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    'advanced': true,
    'rate-limit': true,
    'multicast': true,
  });
  const [is24G, setIs24G] = useState(true);
  const [is5G, setIs5G] = useState(true);
  const [freqInfoLoading, setFreqInfoLoading] = useState(false);
  const [supportedBands, setSupportedBands] = useState<{ is24G: boolean; is5G: boolean; protocols: string[]; maxWidth: number } | null>(null);

  useEffect(() => {
    const bandVal = (iface.band || '').toLowerCase();
    const nameVal = (iface.name || '').toLowerCase();
    
    if (bandVal.includes('5ghz') || bandVal.includes('5.') || nameVal.includes('5g') || nameVal.includes('5ghz') || bandVal === '5ghz-a' || bandVal === '5ghz-a/n' || bandVal === '5ghz-a/n/ac' || bandVal === '5ghz-a/n/ac-ax') {
      setIs24G(false);
      setIs5G(true);
    } else if (bandVal.includes('2ghz') || bandVal.includes('2.4') || bandVal.includes('2g') || bandVal === '2ghz-b' || bandVal === '2ghz-g' || bandVal === '2ghz-b/g' || bandVal === '2ghz-b/g/n') {
      setIs24G(true);
      setIs5G(false);
    } else {
      setIs24G(true);
      setIs5G(true);
    }
  }, [iface.band, iface.name]);

  const fetchHardwareInfo = useCallback(async () => {
    if (!routerIp || !iface.name) return;
    setFreqInfoLoading(true);
    try {
      const resp = await fetch(`/api/wireless-hw-info?ip=${encodeURIComponent(routerIp)}&interface_name=${encodeURIComponent(iface.name || '')}`);
      const data = await resp.json();
      if (data.success && data.hw_info && data.hw_info.ranges) {
        const ranges = data.hw_info.ranges;
        const protocols: string[] = [];
        let has24G = false;
        let has5G = false;
        let maxWidth = 20;
        
        const parts = ranges.split(',');
        for (const part of parts) {
          const trimmed = part.trim();
          
          // 解析频率范围判断频段: "2312-2732/5/b" → 频率2312-2732MHz是2.4G
          const freqMatch = trimmed.match(/^(\d+)-(\d+)\//);
          if (freqMatch) {
            const startFreq = parseInt(freqMatch[1]);
            const endFreq = parseInt(freqMatch[2]);
            if (startFreq >= 2300 && endFreq <= 2800) {
              has24G = true;
            } else if (startFreq >= 4900 && endFreq <= 6200) {
              has5G = true;
            }
          }
          
          // 解析协议: b, g, gn20, gn40, a, an20, an40, ac20, ac40, ac80, ax
          if (trimmed.includes('gn20') || trimmed.includes('gn40') || trimmed.includes('an20') || trimmed.includes('an40')) {
            protocols.push('n');
          }
          if (trimmed.includes('ac')) {
            protocols.push('ac');
          }
          if (trimmed.includes('ax')) {
            protocols.push('ax');
          }
          // 解析协议部分（/ 后面的内容）
          const protoParts = trimmed.split('/');
          if (protoParts.length >= 3) {
            const protoStr = protoParts.slice(2).join('/');
            const protoItems = protoStr.split(',');
            for (const item of protoItems) {
              const clean = item.trim();
              if (clean === 'b') protocols.push('b');
              if (clean === 'g') protocols.push('g');
              if (clean === 'a') protocols.push('a');
              if (clean === 'gn20' || clean === 'gn40' || clean === 'an20' || clean === 'an40') {
                protocols.push('n');
              }
              if (clean.includes('ac')) protocols.push('ac');
              if (clean.includes('ax')) protocols.push('ax');
            }
          } else if (protoParts.length === 1) {
            // 没有 / 分隔符的独立项，如 "g", "gn20"
            const clean = protoParts[0].trim();
            if (clean === 'b') protocols.push('b');
            if (clean === 'g') protocols.push('g');
            if (clean === 'a') protocols.push('a');
            if (clean === 'gn20' || clean === 'gn40' || clean === 'an20' || clean === 'an40') {
              protocols.push('n');
            }
            if (clean.includes('ac')) protocols.push('ac');
            if (clean.includes('ax')) protocols.push('ax');
          }
          
          // 解析最大频宽
          if (trimmed.includes('gn40') || trimmed.includes('an40')) {
            maxWidth = Math.max(maxWidth, 40);
          } else if (trimmed.includes('gn20') || trimmed.includes('an20')) {
            maxWidth = Math.max(maxWidth, 20);
          }
          if (trimmed.includes('ac')) {
            maxWidth = Math.max(maxWidth, 80);
          }
          if (trimmed.includes('ax')) {
            maxWidth = Math.max(maxWidth, 160);
          }
        }
        
        const uniqueProtocols = [...new Set(protocols)];
        setSupportedBands({ is24G: has24G, is5G: has5G, protocols: uniqueProtocols, maxWidth });
        
        if (has24G) setIs24G(true);
        if (has5G) setIs5G(true);
        if (!has24G) setIs24G(false);
        if (!has5G) setIs5G(false);
      }
    } catch (err) {
      console.error('Failed to fetch hardware info:', err);
    } finally {
      setFreqInfoLoading(false);
    }
  }, [routerIp, iface.name]);

  useEffect(() => {
    fetchHardwareInfo();
  }, [fetchHardwareInfo]);

  const getBandOptions = () => {
    if (!supportedBands) {
      return { is24G: true, is5G: true, maxWidth: 40, options24G: [], options5G: [] };
    }
    
    const { is24G: hw24G, is5G: hw5G, protocols, maxWidth } = supportedBands;
    const options24G: string[] = [];
    const options5G: string[] = [];
    
    if (hw24G) {
      if (protocols.includes('b')) {
        options24G.push('2ghz-onlyb');
      }
      if (protocols.includes('g')) {
        options24G.push('2ghz-onlyg');
        if (protocols.includes('b')) {
          options24G.push('2ghz-b/g');
        }
      }
      if (protocols.includes('n')) {
        options24G.push('2ghz-onlyn');
        if (protocols.includes('g')) {
          options24G.push('2ghz-g/n');
        }
        if (protocols.includes('b') && protocols.includes('g')) {
          options24G.push('2ghz-b/g/n');
        }
      }
      if (options24G.length === 0) {
        options24G.push('2ghz-onlyb', '2ghz-onlyg', '2ghz-b/g', '2ghz-onlyn', '2ghz-g/n', '2ghz-b/g/n');
      }
    }
    
    if (hw5G) {
      if (protocols.includes('a')) {
        options5G.push('5ghz-onlya');
      }
      if (protocols.includes('n')) {
        options5G.push('5ghz-onlyn');
        if (protocols.includes('a')) {
          options5G.push('5ghz-a/n');
        }
      }
      if (protocols.includes('ac')) {
        options5G.push('5ghz-onlyac');
        if (protocols.includes('n')) {
          options5G.push('5ghz-n/ac');
        }
        if (protocols.includes('a') && protocols.includes('n')) {
          options5G.push('5ghz-a/n/ac');
        }
      }
      if (protocols.includes('ax')) {
        options5G.push('5ghz-onlyax');
        options5G.push('5ghz-a/n/ac-ax');
      }
      if (options5G.length === 0) {
        options5G.push('5ghz-onlya', '5ghz-onlyn', '5ghz-a/n', '5ghz-onlyac', '5ghz-n/ac', '5ghz-a/n/ac', '5ghz-onlyax', '5ghz-a/n/ac-ax');
      }
    }
    
    return { is24G: hw24G, is5G: hw5G, maxWidth, options24G, options5G };
  };

  const bandOptions = getBandOptions();

  const getBandType = (band: string): '2ghz' | '5ghz' | 'both' => {
    const bandVal = band.toLowerCase();
    const is24G = bandVal.includes('2ghz') || bandVal.includes('2.4');
    const is5G = bandVal.includes('5ghz') || bandVal.includes('5.');
    
    if (is24G && !is5G) return '2ghz';
    if (is5G && !is24G) return '5ghz';
    return 'both';
  };

  const getChannelWidthOptions = (band: string): { value: string; label: string }[] => {
    const bandType = getBandType(band);
    const maxW = supportedBands?.maxWidth ?? 40;
    
    const allOptions: { value: string; label: string }[] = [
      { value: '20mhz', label: '20MHz' },
      { value: '20/40mhz-Ce', label: '20/40MHz (Ce)' },
      { value: '20/40mhz-eC', label: '20/40MHz (eC)' },
    ];
    
    if (bandType === '5ghz' || bandType === 'both') {
      if (maxW >= 80) {
        allOptions.push(
          { value: '20/40/80mhz-Ceee', label: '20/40/80MHz (Ceee)' },
          { value: '20/40/80mhz-eCee', label: '20/40/80MHz (eCee)' },
          { value: '20/40/80mhz-eeCe', label: '20/40/80MHz (eeCe)' },
          { value: '20/40/80mhz-eeeC', label: '20/40/80MHz (eeeC)' },
        );
      }
      if (maxW >= 160) {
        allOptions.push(
          { value: '20/40/80/160mhz-Ceeeeeee', label: '20/40/80/160MHz (Ceeeeeee)' },
          { value: '20/40/80/160mhz-eCeeeeee', label: '20/40/80/160MHz (eCeeeeee)' },
          { value: '20/40/80/160mhz-eeCeeeee', label: '20/40/80/160MHz (eeCeeeee)' },
          { value: '20/40/80/160mhz-eeeCeeee', label: '20/40/80/160MHz (eeeCeeee)' },
          { value: '20/40/80/160mhz-eeeeCeee', label: '20/40/80/160MHz (eeeeCeee)' },
          { value: '20/40/80/160mhz-eeeeeCee', label: '20/40/80/160MHz (eeeeeCee)' },
          { value: '20/40/80/160mhz-eeeeeeCe', label: '20/40/80/160MHz (eeeeeeCe)' },
          { value: '20/40/80/160mhz-eeeeeeeC', label: '20/40/80/160MHz (eeeeeeeC)' },
        );
      }
    }
    
    return allOptions.filter(opt => {
      const val = opt.value.toLowerCase();
      if (val.includes('160')) return maxW >= 160;
      if (val.includes('80')) return maxW >= 80;
      if (val.includes('40')) return maxW >= 40;
      return true;
    });
  };

  const getValidChannelsForWidth = (width: string, bandType: string): number[] => {
    const widthLower = width.toLowerCase();
    
    if (bandType === '2ghz') {
      if (widthLower === '20mhz') {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
      } else if (widthLower === '20/40mhz-ce') {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9];
      } else if (widthLower === '20/40mhz-ec') {
        return [5, 6, 7, 8, 9, 10, 11, 12, 13];
      } else if (widthLower === '20/40mhz') {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
      } else {
        return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
      }
    } else {
      if (widthLower === '20mhz') {
        return [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
      } else if (widthLower === '20/40mhz-ce') {
        return [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157];
      } else if (widthLower === '20/40mhz-ec') {
        return [40, 48, 56, 64, 104, 112, 120, 128, 136, 144, 153, 161];
      } else if (widthLower === '20/40mhz') {
        return [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157];
      } else if (widthLower === '20/40/80mhz' || widthLower === '20/40/80mhz-ceee') {
        return [36, 52, 100, 116, 132, 149];
      } else if (widthLower === '20/40/80mhz-ecee') {
        return [40, 56, 104, 120, 136, 153];
      } else if (widthLower === '20/40/80mhz-eece') {
        return [44, 60, 108, 124, 140, 157];
      } else if (widthLower === '20/40/80mhz-eeec') {
        return [48, 64, 112, 128, 144, 161];
      } else if (widthLower === '20/40/80/160mhz' || widthLower === '20/40/80/160mhz-ceeeeeee') {
        return [36, 100, 132];
      } else if (widthLower === '20/40/80/160mhz-eceeeeee') {
        return [40, 104, 136];
      } else if (widthLower === '20/40/80/160mhz-eeceeeee') {
        return [44, 108, 140];
      } else if (widthLower === '20/40/80/160mhz-eeeceeee') {
        return [48, 112, 144];
      } else if (widthLower === '20/40/80/160mhz-eeeeceee') {
        return [52, 116, 149];
      } else if (widthLower === '20/40/80/160mhz-eeeeecee') {
        return [56, 120, 153];
      } else if (widthLower === '20/40/80/160mhz-eeeeeece') {
        return [60, 124, 157];
      } else if (widthLower === '20/40/80/160mhz-eeeeeeec') {
        return [64, 128, 161];
      }
      return [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];
    }
  };

  const getChannelWidthDisplayValue = (rawValue: string, band: string): string => {
    const options = getChannelWidthOptions(band);
    const rawLower = rawValue.toLowerCase();

    const match = options.find(opt => opt.value.toLowerCase() === rawLower);
    if (match) return match.value;

    if (rawLower === '20/40mhz') {
      const ceMatch = options.find(opt => opt.value.toLowerCase() === '20/40mhz-ce');
      if (ceMatch) return ceMatch.value;
    }

    if (rawLower === '20/40/80mhz') {
      const default80 = options.find(opt => opt.value.toLowerCase() === '20/40/80mhz-ceee');
      if (default80) return default80.value;
    }

    if (rawLower === '20/40/80/160mhz') {
      const default160 = options.find(opt => opt.value.toLowerCase() === '20/40/80/160mhz-ceeeeeee');
      if (default160) return default160.value;
    }

    const bareCe = options.find(opt => opt.value.toLowerCase() === `${rawLower}-ce`);
    if (bareCe) return bareCe.value;
    const bareEc = options.find(opt => opt.value.toLowerCase() === `${rawLower}-ec`);
    if (bareEc) return bareEc.value;
    return options[0]?.value || '20mhz';
  };

  const getFrequencyOptions = useMemo(() => {
    const bandVal = iface.band || '';
    const channelWidth = iface['channel-width'] || '20mhz';
    const country = (iface as any)['country'] || 'no_country_set';
    const freqMode = (iface as any)['frequency-mode'] || 'regulatory-domain';
    
    const bandType = getBandType(bandVal);

    // 超级信道模式：5.8G 显示 4920-6100MHz 全范围，标准信道加粗
    if (freqMode === 'superchannel' && (bandType === '5ghz' || bandType === 'both')) {
      return superchannelOptions5G;
    }

    const validChannels = getValidChannelsForWidth(channelWidth, bandType);
    
    let filteredChannels = validChannels;
    
    if (freqMode !== 'superchannel' && country !== 'no_country_set' && countryFrequencyRules[country]) {
      const countryRule = countryFrequencyRules[country];
      const allowedChannels = bandType === '2ghz' ? countryRule.channels24G : countryRule.channels5G;
      filteredChannels = validChannels.filter(ch => allowedChannels.includes(ch));
    }
    
    const allFrequencies = bandType === '2ghz' ? frequencyOptions24G : 
                          bandType === '5ghz' ? frequencyOptions5G : 
                          [...frequencyOptions24G, ...frequencyOptions5G];
    
    return allFrequencies.filter(freq => filteredChannels.includes(freq.channel));
  }, [iface.band, iface['channel-width'], (iface as any)['country'], (iface as any)['frequency-mode']]);

  const parseRates = (rateStr: string | undefined): string[] => {
    if (!rateStr) return [];
    return rateStr.split(',').map(r => r.trim()).filter(r => r);
  };

  const formatRates = (rates: string[]): string => {
    return rates.join(',');
  };

  const getRateCheckboxState = (rateStr: string | undefined, rateValue: string): boolean => {
    const rates = parseRates(rateStr);
    return rates.some(r => r.toLowerCase() === rateValue.toLowerCase());
  };

  const updateRate = (field: string, rateValue: string, checked: boolean) => {
    const currentRates = parseRates(iface[field]);
    if (checked) {
      if (!currentRates.some(r => r.toLowerCase() === rateValue.toLowerCase())) {
        currentRates.push(rateValue);
      }
    } else {
      const idx = currentRates.findIndex(r => r.toLowerCase() === rateValue.toLowerCase());
      if (idx >= 0) currentRates.splice(idx, 1);
    }
    updateField(field, formatRates(currentRates));
  };

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateField = (field: string, value: any) => {
    const updated = { ...iface, [field]: value };
    
    if (field === 'band') {
      const bandVal = String(value).toLowerCase();
      if (bandVal.includes('2ghz') || bandVal.includes('2.4') || bandVal === '2ghz-b' || bandVal === '2ghz-g' || bandVal === '2ghz-b/g' || bandVal === '2ghz-b/g/n') {
        updated.frequency = '2412';
      } else if (bandVal.includes('5ghz') || bandVal.includes('5.') || bandVal === '5ghz-a' || bandVal === '5ghz-a/n' || bandVal === '5ghz-a/n/ac' || bandVal === '5ghz-a/n/ac-ax') {
        updated.frequency = '5180';
      }
      
      const bandType = getBandType(String(value));
      if (bandType === '2ghz') {
        updated['channel-width'] = '20mhz';
      } else if (bandType === '5ghz') {
        updated['channel-width'] = '20mhz';
      }
    }
    
    if (field === 'channel-width') {
      const currentFreq = iface.frequency;
      if (currentFreq) {
        const currentChannel = frequencyOptions24G.find(f => f.value === currentFreq)?.channel || 
                              frequencyOptions5G.find(f => f.value === currentFreq)?.channel;
        if (currentChannel) {
          const bandType = getBandType(iface.band || '');
          const validChannels = getValidChannelsForWidth(String(value), bandType);
          if (!validChannels.includes(currentChannel)) {
            const newChannel = validChannels[0];
            const newFreq = frequencyOptions24G.find(f => f.channel === newChannel) || 
                           frequencyOptions5G.find(f => f.channel === newChannel);
            if (newFreq) {
              updated.frequency = newFreq.value;
            }
          }
        }
      }
    }
    
    if (field === 'frequency-mode') {
      const currentFreq = iface.frequency;
      const bandType = getBandType(iface.band || '');

      // 切换到超级信道：5.8G 频率范围 4920-6100MHz
      if (value === 'superchannel' && (bandType === '5ghz' || bandType === 'both')) {
        if (currentFreq) {
          const freqNum = parseInt(currentFreq, 10);
          if (isNaN(freqNum) || freqNum < 4920 || freqNum > 6100) {
            updated.frequency = '5180';
          }
        } else {
          updated.frequency = '5180';
        }
      }

      if (currentFreq && value === 'regulatory-domain') {
        const currentChannel = frequencyOptions24G.find(f => f.value === currentFreq)?.channel || 
                              frequencyOptions5G.find(f => f.value === currentFreq)?.channel;
        if (currentChannel) {
          const channelWidth = iface['channel-width'] || '20mhz';
          const validChannels = getValidChannelsForWidth(channelWidth, bandType);
          const country = (iface as any)['country'] || 'no_country_set';
          let allowedChannels = validChannels;
          if (country !== 'no_country_set' && countryFrequencyRules[country]) {
            const countryRule = countryFrequencyRules[country];
            const chs = bandType === '2ghz' ? countryRule.channels24G : countryRule.channels5G;
            allowedChannels = validChannels.filter(ch => chs.includes(ch));
          }
          if (!allowedChannels.includes(currentChannel)) {
            const newChannel = allowedChannels[0];
            const newFreq = frequencyOptions24G.find(f => f.channel === newChannel) || 
                           frequencyOptions5G.find(f => f.channel === newChannel);
            if (newFreq) {
              updated.frequency = newFreq.value;
            }
          }
        }
      }
    }
    
    if (field === 'country') {
      const currentFreq = iface.frequency;
      const freqMode = (iface as any)['frequency-mode'] || 'regulatory-domain';
      if (currentFreq && value !== 'no_country_set' && freqMode !== 'superchannel') {
        const currentChannel = frequencyOptions24G.find(f => f.value === currentFreq)?.channel || 
                              frequencyOptions5G.find(f => f.value === currentFreq)?.channel;
        if (currentChannel && countryFrequencyRules[value]) {
          const bandType = getBandType(iface.band || '');
          const allowedChannels = bandType === '2ghz' ? countryFrequencyRules[value].channels24G : countryFrequencyRules[value].channels5G;
          if (!allowedChannels.includes(currentChannel)) {
            const newChannel = allowedChannels[0];
            const newFreq = frequencyOptions24G.find(f => f.channel === newChannel) || 
                           frequencyOptions5G.find(f => f.channel === newChannel);
            if (newFreq) {
              updated.frequency = newFreq.value;
            }
          }
        }
      }
    }
    
    onChange(updated);
  };

  const renderGeneralTab = () => (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>名称</label>
            <Input
              value={iface.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="接口名称"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>类型</label>
            <Input value={iface.type || '无线'} disabled className={styles.inputDisabled} />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>MTU</label>
            <Input
              value={(iface as any)['mtu'] || '1500'}
              onChange={(e) => updateField('mtu', e.target.value)}
              placeholder="1500"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>L2 MTU</label>
            <Input
              value={(iface as any)['l2mtu'] || '1600'}
              onChange={(e) => updateField('l2mtu', e.target.value)}
              placeholder="1600"
            />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>MAC 地址</label>
            <Input value={iface.mac_address || ''} disabled className={styles.inputDisabled} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>ARP</label>
            <Select
              value={(iface as any)['arp'] || 'enabled'}
              onChange={(value) => updateField('arp', value)}
              style={{ width: '100%' }}
            >
              <Option value="enabled">启用</Option>
              <Option value="disabled">禁用</Option>
              <Option value="local-proxy-arp">本地代理 ARP</Option>
              <Option value="proxy-arp">代理 ARP</Option>
              <Option value="reply-only">仅回复</Option>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWirelessTab = () => (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>基本配置</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>模式</label>
            <Select
              value={iface.mode || (nlevel !== null && nlevel >= 4 ? 'ap-bridge' : 'station')}
              onChange={(value) => updateField('mode', value)}
              style={{ width: '100%' }}
            >
              {nlevel === null || nlevel >= 4 ? (
                <Option value="ap-bridge">AP（点对多点）</Option>
              ) : null}
              <Option value="bridge">PTP（点对点）</Option>
              <Option value="station">Station（标准三层）</Option>
              <Option value="station-bridge">Station（二层）</Option>
              <Option value="station-pseudobridge">Station（对接）</Option>
              <Option value="station-wds">Station（WDS）</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>物理协议</label>
            <Select
              value={iface.band || '2ghz-b/g/n'}
              onChange={(value) => updateField('band', value)}
              style={{ width: '100%' }}
            >
              {bandOptions.is24G && bandOptions.options24G.map((opt) => (
                <Option key={opt} value={opt}>
                  {opt === '2ghz-onlyb' && '2GHz-only-B'}
                  {opt === '2ghz-onlyg' && '2GHz-only-G'}
                  {opt === '2ghz-b/g' && '2GHz-B/G'}
                  {opt === '2ghz-onlyn' && '2GHz-only-N'}
                  {opt === '2ghz-g/n' && '2GHz-G/N'}
                  {opt === '2ghz-b/g/n' && '2GHz-B/G/N'}
                </Option>
              ))}
              {bandOptions.is5G && bandOptions.options5G.map((opt) => (
                <Option key={opt} value={opt}>
                  {opt === '5ghz-onlya' && '5GHz-only-A'}
                  {opt === '5ghz-onlyn' && '5GHz-only-N'}
                  {opt === '5ghz-a/n' && '5GHz-A/N'}
                  {opt === '5ghz-onlyac' && '5GHz-only-AC'}
                  {opt === '5ghz-n/ac' && '5GHz-N/AC'}
                  {opt === '5ghz-a/n/ac' && '5GHz-A/N/AC'}
                  {opt === '5ghz-onlyax' && '5GHz-only-AX'}
                  {opt === '5ghz-a/n/ac-ax' && '5GHz-A/N/AC/AX'}
                </Option>
              ))}
            </Select>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>信道宽度</label>
            <Select
              value={getChannelWidthDisplayValue(iface['channel-width'] || '20mhz', iface.band || '2ghz-b/g/n')}
              onChange={(value) => updateField('channel-width', value)}
              style={{ width: '100%' }}
            >
              {getChannelWidthOptions(iface.band || '2ghz-b/g/n').map((opt) => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>频率</label>
            <Select
              value={iface.frequency || ''}
              onChange={(value) => updateField('frequency', value)}
              style={{ width: '100%' }}
              showSearch
              placeholder="选择频率"
              optionFilterProp="children"
            >
              {getFrequencyOptions.map((opt: any) => (
                <Option
                  key={opt.value}
                  value={opt.value}
                  style={opt.isStandard ? { fontWeight: 700 } : undefined}
                >
                  {opt.label}
                </Option>
              ))}
            </Select>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>SSID</label>
            <Input
              value={iface.ssid || ''}
              onChange={(e) => updateField('ssid', e.target.value)}
              placeholder="无线网络名称"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>射频接口名称</label>
            <Input
              value={(iface as any)['radio-name'] || ''}
              onChange={(e) => updateField('radio-name', e.target.value)}
              placeholder="射频接口名称"
            />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>信道绑定</label>
            <Input
              value={(iface as any)['scan-list'] || 'default'}
              onChange={(e) => updateField('scan-list', e.target.value)}
              placeholder="default"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>无线协议</label>
            <Select
              value={iface['wireless-protocol'] || '802.11'}
              onChange={(value) => updateField('wireless-protocol', value)}
              style={{ width: '100%' }}
            >
              <Option value="802.11">802.11</Option>
              <Option value="nv2">NV2</Option>
              <Option value="nv2-nstreme">NV2-Nstreme</Option>
              <Option value="nstreme">Nstreme</Option>
            </Select>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup} style={!['station', 'station-bridge', 'station-pseudobridge', 'station-wds'].includes(iface.mode || '') ? { maxWidth: 'calc(50% - 8px)' } : undefined}>
            <label className={styles.formLabel}>无线加密</label>
            <Select
              value={(iface as any)['security-profile'] || 'none'}
              onChange={(value) => updateField('security-profile', value === 'none' ? '' : value)}
              style={{ width: '100%' }}
              disabled={iface['wireless-protocol'] !== '802.11'}
              placeholder={iface['wireless-protocol'] !== '802.11' ? '仅802.11协议支持' : '选择加密配置'}
            >
              <Option value="none">无加密</Option>
              {(securityProfiles || []).map((profile: SecurityProfileData) => (
                <Option key={profile.name} value={profile.name}>{profile.name}</Option>
              ))}
            </Select>
          </div>
          {['station', 'station-bridge', 'station-pseudobridge', 'station-wds'].includes(iface.mode || '') && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>终端漫游</label>
              <Select
                value={(iface as any)['station-roaming'] || 'disabled'}
                onChange={(value) => updateField('station-roaming', value)}
                style={{ width: '100%' }}
              >
                <Option value="disabled">禁用</Option>
                <Option value="enabled">启用</Option>
              </Select>
            </div>
          )}
        </div>

        <div className={styles.checkboxInlineGroup}>
          <Checkbox
            checked={(iface as any)['default-authenticate'] === 'yes'}
            onChange={(e) => updateField('default-authenticate', e.target.checked ? 'yes' : 'no')}
          >
            默认认证
          </Checkbox>
          <Checkbox
            checked={(iface as any)['default-forwarding'] === 'yes'}
            onChange={(e) => updateField('default-forwarding', e.target.checked ? 'yes' : 'no')}
          >
            默认转发
          </Checkbox>
          <Checkbox
            checked={iface['hide-ssid'] === 'yes'}
            onChange={(e) => updateField('hide-ssid', e.target.checked ? 'yes' : 'no')}
          >
            隐藏 SSID
          </Checkbox>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle} onClick={() => toggleSection('advanced')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          {collapsedSections['advanced'] ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
          高级无线配置
        </h3>
        {!collapsedSections['advanced'] && (
        <>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>频率模式</label>
            <Select
              value={(iface as any)['frequency-mode'] || 'regulatory-domain'}
              onChange={(value) => updateField('frequency-mode', value)}
              style={{ width: '100%' }}
            >
              <Option value="regulatory-domain">法规域</Option>
              <Option value="superchannel">超级信道</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>国家</label>
            <Select
              value={(iface as any)['country'] || 'no_country_set'}
              onChange={(value) => updateField('country', value)}
              style={{ width: '100%' }}
              showSearch
              placeholder="选择国家"
              optionFilterProp="children"
            >
              {countryList.map((country) => (
                <Option key={country.value} value={country.value}>{country.label}</Option>
              ))}
            </Select>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>安装环境</label>
            <Select
              value={(iface as any)['installation'] || 'any'}
              onChange={(value) => updateField('installation', value)}
              style={{ width: '100%' }}
            >
              <Option value="any">任意</Option>
              <Option value="indoor">室内</Option>
              <Option value="outdoor">室外</Option>
            </Select>
          </div>
        </div>
        </>
        )}
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle} onClick={() => toggleSection('rate-limit')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          {collapsedSections['rate-limit'] ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
          速率限制
        </h3>
        {!collapsedSections['rate-limit'] && (
        <>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>AP下行限速</label>
            <Input
              value={(iface as any)['default-ap-tx-limit'] || ''}
              onChange={(e) => updateField('default-ap-tx-limit', e.target.value)}
              placeholder="bps"
              addonAfter="bps"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>终端上行限速</label>
            <Input
              value={(iface as any)['default-client-tx-limit'] || ''}
              onChange={(e) => updateField('default-client-tx-limit', e.target.value)}
              placeholder="bps"
              addonAfter="bps"
            />
          </div>
        </div>
        </>
        )}
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle} onClick={() => toggleSection('multicast')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          {collapsedSections['multicast'] ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
          组播
        </h3>
        {!collapsedSections['multicast'] && (
        <>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>组播助手</label>
            <Select
              value={(iface as any)['multicast-helper'] || 'default'}
              onChange={(value) => updateField('multicast-helper', value)}
              style={{ width: '100%' }}
            >
              <Option value="default">默认</Option>
              <Option value="disabled">禁用</Option>
              <Option value="full">完全</Option>
            </Select>
          </div>
        </div>

        <div className={styles.checkboxGroup}>
          <Checkbox
            checked={(iface as any)['multicast-buffering'] === 'enabled'}
            onChange={(e) => updateField('multicast-buffering', e.target.checked ? 'enabled' : 'disabled')}
          >
            组播缓冲
          </Checkbox>
          <Checkbox
            checked={(iface as any)['keepalive-frames'] === 'enabled'}
            onChange={(e) => updateField('keepalive-frames', e.target.checked ? 'enabled' : 'disabled')}
          >
            保活帧
          </Checkbox>
        </div>
        </>
        )}
      </div>
    </div>
  );

  const renderDataRatesTab = () => {
    const isRateDefault = ((iface as any)['rate-set'] || 'default') === 'default';
    return (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>速率</h3>
        <div className={styles.radioGroup}>
          <span className={styles.radioLabel}>速率集:</span>
          <Radio.Group
            value={(iface as any)['rate-set'] || 'default'}
            onChange={(e) => updateField('rate-set', e.target.value)}
          >
            <Radio value="default">默认</Radio>
            <Radio value="configured">自定义</Radio>
          </Radio.Group>
        </div>

        <div className={styles.rateSection} style={isRateDefault ? { pointerEvents: 'none' } : undefined}>
          <div className={styles.rateRow}>
            <span className={styles.rateLabel}>B 支持速率:</span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-b'], '1Mbps')} onChange={(e) => updateRate('supported-rates-b', '1Mbps', e.target.checked)}>1Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-b'], '2Mbps')} onChange={(e) => updateRate('supported-rates-b', '2Mbps', e.target.checked)}>2Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-b'], '5.5Mbps')} onChange={(e) => updateRate('supported-rates-b', '5.5Mbps', e.target.checked)}>5.5Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-b'], '11Mbps')} onChange={(e) => updateRate('supported-rates-b', '11Mbps', e.target.checked)}>11Mbps</Checkbox>
            </div>
          </div>

          <div className={styles.rateRow}>
            <span className={styles.rateLabel}>A/G 支持速率:</span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '6Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '6Mbps', e.target.checked)}>6Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '9Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '9Mbps', e.target.checked)}>9Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '12Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '12Mbps', e.target.checked)}>12Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '18Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '18Mbps', e.target.checked)}>18Mbps</Checkbox>
            </div>
          </div>

          <div className={styles.rateRow}>
            <span className={styles.rateLabel}></span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '24Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '24Mbps', e.target.checked)}>24Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '36Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '36Mbps', e.target.checked)}>36Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '48Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '48Mbps', e.target.checked)}>48Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['supported-rates-a/g'], '54Mbps')} onChange={(e) => updateRate('supported-rates-a/g', '54Mbps', e.target.checked)}>54Mbps</Checkbox>
            </div>
          </div>

          <div className={styles.rateRow}>
            <span className={styles.rateLabel}>B 基本速率:</span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-b'], '1Mbps')} onChange={(e) => updateRate('basic-rates-b', '1Mbps', e.target.checked)}>1Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-b'], '2Mbps')} onChange={(e) => updateRate('basic-rates-b', '2Mbps', e.target.checked)}>2Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-b'], '5.5Mbps')} onChange={(e) => updateRate('basic-rates-b', '5.5Mbps', e.target.checked)}>5.5Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-b'], '11Mbps')} onChange={(e) => updateRate('basic-rates-b', '11Mbps', e.target.checked)}>11Mbps</Checkbox>
            </div>
          </div>

          <div className={styles.rateRow}>
            <span className={styles.rateLabel}>A/G 基本速率:</span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '6Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '6Mbps', e.target.checked)}>6Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '9Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '9Mbps', e.target.checked)}>9Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '12Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '12Mbps', e.target.checked)}>12Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '18Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '18Mbps', e.target.checked)}>18Mbps</Checkbox>
            </div>
          </div>

          <div className={styles.rateRow}>
            <span className={styles.rateLabel}></span>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '24Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '24Mbps', e.target.checked)}>24Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '36Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '36Mbps', e.target.checked)}>36Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '48Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '48Mbps', e.target.checked)}>48Mbps</Checkbox>
              <Checkbox disabled={isRateDefault} checked={getRateCheckboxState((iface as any)['basic-rates-a/g'], '54Mbps')} onChange={(e) => updateRate('basic-rates-a/g', '54Mbps', e.target.checked)}>54Mbps</Checkbox>
            </div>
          </div>
        </div>
      </div>
    </div>
    );
  };

  const renderAdvancedTab = () => {
    const isApMode = iface.mode === 'ap-bridge' || iface.mode === 'bridge';
    return (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>距离与天线</h3>
        <div className={styles.formRow}>
          {isApMode && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>区域</label>
              <Input
                value={(iface as any)['area'] || ''}
                onChange={(e) => updateField('area', e.target.value)}
                placeholder=""
              />
            </div>
          )}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>距离优化</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {(() => {
                // 英文值到中文显示的映射
                const distanceValue = (iface as any)['distance'] || 'dynamic';
                const distanceLabelMap: { [key: string]: string } = { dynamic: '自适应', indoors: '室内' };
                // 显示值：英文选项显示中文，数字或其他值原样显示
                const displayValue = distanceLabelMap[distanceValue] || distanceValue;
                return (
                  <AutoComplete
                    value={displayValue}
                    onChange={(value) => {
                      // 中文显示值反向映射回英文值
                      const reverseMap: { [key: string]: string } = { '自适应': 'dynamic', '室内': 'indoors' };
                      updateField('distance', reverseMap[value] || value);
                    }}
                    style={{ flex: 1 }}
                    filterOption={false}
                    placeholder="自适应/室内 或输入数字"
                  >
                    <Option value="自适应">自适应</Option>
                    <Option value="室内">室内</Option>
                  </AutoComplete>
                );
              })()}
              <span style={{ whiteSpace: 'nowrap', color: 'var(--color-text-primary)' }}>KM</span>
            </div>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>最大站点数</label>
            <Input
              value={(iface as any)['max-station-count'] || '2007'}
              onChange={(e) => updateField('max-station-count', e.target.value)}
              placeholder="2007"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>硬件重试次数</label>
            <Input
              value={(iface as any)['hw-retries'] || '7'}
              onChange={(e) => updateField('hw-retries', e.target.value)}
              placeholder="7"
            />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>自适应噪声</label>
            <Select
              value={(iface as any)['adaptive-noise-immunity'] || 'none'}
              onChange={(value) => updateField('adaptive-noise-immunity', value)}
              style={{ width: '100%' }}
            >
              <Option value="none">无</Option>
              <Option value="client-mode">客户端模式</Option>
              <Option value="ap-and-client-mode">AP 和客户端模式</Option>
            </Select>
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>前导码与认证</h3>
        <div className={styles.radioGroup}>
          <span className={styles.radioLabel}>前导码模式:</span>
          <Radio.Group
            value={(iface as any)['preamble-mode'] || 'both'}
            onChange={(e) => updateField('preamble-mode', e.target.value)}
          >
            <Radio value="long">长</Radio>
            <Radio value="short">短</Radio>
            <Radio value="both">两者</Radio>
          </Radio.Group>
        </div>

        <div className={styles.checkboxGroup}>
          <Checkbox
            checked={(iface as any)['allow-sharedkey'] === 'yes'}
            onChange={(e) => updateField('allow-sharedkey', e.target.checked ? 'yes' : 'no')}
          >
            允许共享密钥
          </Checkbox>
        </div>
      </div>
    </div>
    );
  };

  const renderTxPowerTab = () => {
    const txPowerMode = (iface as any)['tx-power-mode'] || 'default';
    const showTxPowerInput = txPowerMode !== 'default';
    return (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>发射功率配置</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>发射功率模式</label>
            <Select
              value={txPowerMode}
              onChange={(value) => updateField('tx-power-mode', value)}
              style={{ width: '100%' }}
            >
              <Option value="default">默认</Option>
              <Option value="all-rates-fixed">手动配置</Option>
            </Select>
          </div>
        </div>

        {showTxPowerInput && (
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>发射功率</label>
              <Input
                value={(iface as any)['tx-power'] ?? ''}
                onChange={(e) => updateField('tx-power', e.target.value)}
                placeholder="-30 ~ 30"
                addonAfter="dBm"
                type="text"
                className={styles.hideSpinner}
              />
            </div>
          </div>
        )}
      </div>
    </div>
    );
  };

  const renderPlaceholderTab = (tabName: string) => (
    <div className={styles.tabContent}>
      <div className={styles.emptyState}>
        <p>{tabName} 配置选项</p>
      </div>
    </div>
  );

  // WDS 标签：参考 Winbox 中 WDS 标签栏
  // 包含 wds-mode 和 wds-default-bridge（排除 wds-default-cost、wds-cost-range、wds-ignore-ssid）
  const [wdsBridges, setWdsBridges] = useState<string[]>([]);
  const [wdsBridgesLoaded, setWdsBridgesLoaded] = useState(false);

  useEffect(() => {
    if (activeTab !== 'wds' || wdsBridgesLoaded || !routerIp) return;
    setWdsBridgesLoaded(true);
    fetch(`/api/device/bridges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: routerIp }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && Array.isArray(data.bridges)) {
          setWdsBridges(data.bridges.map((b: any) => b.name || b['.id']).filter(Boolean));
        }
      })
      .catch(() => {});
  }, [activeTab, wdsBridgesLoaded, routerIp]);

  const renderWDSTab = () => (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>WDS 配置</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>WDS 模式</label>
            <Select
              value={iface['wds-mode'] || 'disabled'}
              onChange={(value) => updateField('wds-mode', value)}
              style={{ width: '100%' }}
            >
              <Option value="disabled">禁用</Option>
              <Option value="static">静态</Option>
              <Option value="dynamic">动态</Option>
              <Option value="mesh">Mesh</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>WDS 默认桥接</label>
            <Select
              value={iface['wds-default-bridge'] || 'none'}
              onChange={(value) => updateField('wds-default-bridge', value)}
              style={{ width: '100%' }}
            >
              <Option value="none">无</Option>
              {wdsBridges.map(name => (
                <Option key={name} value={name}>{name}</Option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </div>
  );

  // Nstreme 标签：参考 Winbox 中 Nstreme 标签栏
  // Nstreme 配置位于独立子菜单 /interface wireless nstreme
  // 字段：enable-nstreme, enable-polling, disable-csma, framer-policy, framer-limit
  const renderNstremeTab = () => (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>Nstreme 配置</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>启用 Nstreme</label>
            <Select
              value={(iface as any)['enable-nstreme'] || 'no'}
              onChange={(value) => updateField('enable-nstreme', value)}
              style={{ width: '100%' }}
            >
              <Option value="no">否</Option>
              <Option value="yes">是</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>启用轮询</label>
            <Select
              value={(iface as any)['enable-polling'] || 'yes'}
              onChange={(value) => updateField('enable-polling', value)}
              style={{ width: '100%' }}
            >
              <Option value="no">否</Option>
              <Option value="yes">是</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>禁用 CSMA</label>
            <Select
              value={(iface as any)['disable-csma'] || 'no'}
              onChange={(value) => updateField('disable-csma', value)}
              style={{ width: '100%' }}
            >
              <Option value="no">否</Option>
              <Option value="yes">是</Option>
            </Select>
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>帧聚合</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>帧打包策略</label>
            <Select
              value={(iface as any)['framer-policy'] || 'none'}
              onChange={(value) => updateField('framer-policy', value)}
              style={{ width: '100%' }}
            >
              <Option value="none">none - 不打包</Option>
              <Option value="best-fit">best-fit - 最佳匹配</Option>
              <Option value="exact-size">exact-size - 精确大小</Option>
              <Option value="dynamic-size">dynamic-size - 动态大小</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>帧大小上限</label>
            <Input
              type="number"
              value={(iface as any)['framer-limit'] ?? '3200'}
              onChange={(e) => updateField('framer-limit', e.target.value)}
              placeholder="3200"
              min={0}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // HT 标签：同步 winbox 中 HT 标签栏内容
  const renderHTTab = () => {
    // 解析 tx-chains / rx-chains 字符串为 Chain0/Chain1 勾选状态
    const parseChains = (value: string): { chain0: boolean; chain1: boolean } => {
      if (!value) return { chain0: true, chain1: false };
      // 兼容逗号、分号、空格分隔
      const nums = String(value).split(/[,;\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      return {
        chain0: nums.includes(0),
        chain1: nums.includes(1),
      };
    };
    const buildChains = (chain0: boolean, chain1: boolean): string => {
      const nums: number[] = [];
      if (chain0) nums.push(0);
      if (chain1) nums.push(1);
      return nums.join(',');
    };
    const txChains = parseChains((iface as any)['tx-chains'] || '');
    const rxChains = parseChains((iface as any)['rx-chains'] || '');
    return (
    <div className={styles.tabContent}>
      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>基本配置</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>保护间隔</label>
            <Select
              value={(iface as any)['guard-interval'] || 'any'}
              onChange={(value) => updateField('guard-interval', value)}
              style={{ width: '100%' }}
            >
              <Option value="any">任意</Option>
              <Option value="long">长</Option>
            </Select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>WMM 支持</label>
            <Select
              value={(iface as any)['wmm-support'] || 'disabled'}
              onChange={(value) => updateField('wmm-support', value)}
              style={{ width: '100%' }}
            >
              <Option value="disabled">禁用</Option>
              <Option value="enabled">启用</Option>
              <Option value="required">必需</Option>
            </Select>
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>发射极化</label>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox
                checked={txChains.chain0}
                onChange={(e) => updateField('tx-chains', buildChains(e.target.checked, txChains.chain1))}
              >
                Chain0
              </Checkbox>
              <Checkbox
                checked={txChains.chain1}
                onChange={(e) => updateField('tx-chains', buildChains(txChains.chain0, e.target.checked))}
              >
                Chain1
              </Checkbox>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>接收极化</label>
            <div className={styles.checkboxInlineGroup}>
              <Checkbox
                checked={rxChains.chain0}
                onChange={(e) => updateField('rx-chains', buildChains(e.target.checked, rxChains.chain1))}
              >
                Chain0
              </Checkbox>
              <Checkbox
                checked={rxChains.chain1}
                onChange={(e) => updateField('rx-chains', buildChains(rxChains.chain0, e.target.checked))}
              >
                Chain1
              </Checkbox>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3 className={styles.sectionTitle}>聚合</h3>
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>A-MPDU 优先级</label>
            <Input
              value={(iface as any)['ampdu-priorities'] || '0'}
              onChange={(e) => updateField('ampdu-priorities', e.target.value)}
              placeholder="如 0"
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>A-MSDU 限制</label>
            <Input
              value={(iface as any)['amsdu-limit'] || '8192'}
              onChange={(e) => updateField('amsdu-limit', e.target.value)}
              placeholder="字节"
              addonAfter="bytes"
            />
          </div>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>A-MSDU 阈值</label>
            <Input
              value={(iface as any)['amsdu-threshold'] || '8192'}
              onChange={(e) => updateField('amsdu-threshold', e.target.value)}
              placeholder="字节"
              addonAfter="bytes"
            />
          </div>
        </div>
      </div>
    </div>
    );
  };

  // MCS 速率标签：Basic MCS / Supported MCS 勾选框
  const renderMCSTab = () => {
    // 速率集为 default 时，MCS 速率不可操作
    const isRateDefault = ((iface as any)['rate-set'] || 'default') === 'default';
    // Supported MCS: 0-23（802.11n/ac）
    const supportedMcsList = Array.from({ length: 24 }, (_, i) => `mcs-${i}`);
    // HT Basic MCS: 0-19（参考 Winbox，Basic MCS 最大到 mcs-19）
    const basicMcsList = Array.from({ length: 20 }, (_, i) => `mcs-${i}`);

    // 解析 MCS 字符串为 Set（兼容逗号和分号分隔符）
    const parseMcs = (value: string): Set<string> => {
      if (!value) return new Set();
      return new Set(String(value).split(/[,;]/).map(s => s.trim()).filter(Boolean));
    };

    // 构建 MCS 字符串
    const buildMcs = (mcsSet: Set<string>): string => {
      return Array.from(mcsSet).sort((a, b) => {
        const na = parseInt(a.replace('mcs-', ''), 10);
        const nb = parseInt(b.replace('mcs-', ''), 10);
        return na - nb;
      }).join(','); // MikroTik API 使用逗号分隔
    };

    // Basic MCS：空值表示全部支持（与 Winbox 一致，默认全部勾选）
    const basicMcsRaw = (iface as any)['ht-basic-mcs'] || '';
    const basicMcsIsEmpty = basicMcsRaw === '';
    const basicMcs = basicMcsIsEmpty
      ? new Set(basicMcsList) // 空值表示支持全部，全部勾选
      : parseMcs(basicMcsRaw);
    // 支持 MCS：空值表示支持所有 MCS，此时所有项应显示为勾选状态
    const supportedMcsRaw = (iface as any)['ht-supported-mcs'] || '';
    const supportedMcsIsEmpty = supportedMcsRaw === '';
    const supportedMcs = supportedMcsIsEmpty
      ? new Set(supportedMcsList) // 空值表示支持全部，全部勾选
      : parseMcs(supportedMcsRaw);

    // 检查冲突：Basic MCS 必须是 Supported MCS 的子集
    const checkConflict = (newBasic: Set<string>, newSupported: Set<string>): string | null => {
      if (newSupported.size === 0) return null; // 空表示支持全部，不冲突
      for (const mcs of newBasic) {
        if (!newSupported.has(mcs)) {
          return mcs;
        }
      }
      return null;
    };

    // 切换 Basic MCS
    const toggleBasic = (mcs: string, checked: boolean) => {
      if (isRateDefault) return;
      const newBasic = new Set(basicMcs);
      if (checked) {
        newBasic.add(mcs);
      } else {
        newBasic.delete(mcs);
      }
      const conflict = checkConflict(newBasic, supportedMcs);
      if (conflict) {
        Modal.warning({
          title: 'MCS 速率冲突',
          content: `${conflict} 在基本 MCS 中被勾选，但未在支持 MCS 中勾选。基本 MCS 必须是支持 MCS 的子集。请先在支持 MCS 中勾选 ${conflict}。`,
        });
        return;
      }
      // 若全部勾选，写空值表示支持全部；否则写实际值
      if (newBasic.size === basicMcsList.length) {
        updateField('ht-basic-mcs', '');
      } else {
        updateField('ht-basic-mcs', buildMcs(newBasic));
      }
    };

    // 切换 Supported MCS
    const toggleSupported = (mcs: string, checked: boolean) => {
      if (isRateDefault) return;
      const newSupported = new Set(supportedMcs);
      if (checked) {
        newSupported.add(mcs);
      } else {
        newSupported.delete(mcs);
        const conflict = checkConflict(basicMcs, newSupported);
        if (conflict) {
          Modal.warning({
            title: 'MCS 速率冲突',
            content: `${conflict} 在基本 MCS 中已勾选，无法从支持 MCS 中移除。请先取消基本 MCS 中的 ${conflict}。`,
          });
          return;
        }
      }
      if (newSupported.size === supportedMcsList.length) {
        updateField('ht-supported-mcs', '');
      } else {
        updateField('ht-supported-mcs', buildMcs(newSupported));
      }
    };

    return (
      <div className={styles.tabContent} style={isRateDefault ? { pointerEvents: 'none' } : undefined}>
        <div className={styles.formSection}>
          <h3 className={styles.sectionTitle}>基本 MCS（客户端必须支持的基本速率）</h3>
          <div className={styles.checkboxInlineGroup}>
            {basicMcsList.map(mcs => (
              <Checkbox
                key={mcs}
                checked={basicMcs.has(mcs)}
                disabled={isRateDefault}
                onChange={(e) => toggleBasic(mcs, e.target.checked)}
                style={{ width: 90 }}
              >
                {mcs}
              </Checkbox>
            ))}
          </div>
        </div>

        <div className={styles.formSection}>
          <h3 className={styles.sectionTitle}>支持 MCS（AP 支持的传输速率）</h3>
          <div className={styles.checkboxInlineGroup}>
            {supportedMcsList.map(mcs => (
              <Checkbox
                key={mcs}
                checked={supportedMcs.has(mcs)}
                disabled={isRateDefault}
                onChange={(e) => toggleSupported(mcs, e.target.checked)}
                style={{ width: 90 }}
              >
                {mcs}
              </Checkbox>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return renderGeneralTab();
      case 'wireless':
        return renderWirelessTab();
      case 'datarates':
        return renderDataRatesTab();
      case 'advanced':
        return renderAdvancedTab();
      case 'ht':
        return renderHTTab();
      case 'mcs':
        return renderMCSTab();
      case 'wds':
        return renderWDSTab();
      case 'nstreme':
        return renderNstremeTab();
      case 'txpower':
        return renderTxPowerTab();
      default:
        return renderGeneralTab();
    }
  };

  // MCS 速率仅在 802.11n/ac/ax 频段下有效
  // 纯 802.11a/b/g 频段（无 n/ac/ax）无 MCS 速率，不显示 MCS 速率标签
  const visibleTabs = tabs.filter(tab => {
    if (tab.key === 'mcs') {
      const band = (iface as any)['band'] || '';
      // 包含 n、ac、ax 的频段才支持 MCS
      if (!/n|ac|ax/.test(band)) return false;
    }
    return true;
  });

  return (
    <div className={styles.container}>
      <div className={styles.tabBar}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tabButton} ${activeTab === tab.key ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel}>
        {renderTabContent()}
      </div>
      <div className={styles.statusBar}>
        <span className={styles.statusItem}>
          <span className={styles.statusLabel}>已启用:</span>
          <span className={styles.statusValue}>{iface.disabled ? '否' : '是'}</span>
        </span>
        <span className={styles.statusItem}>
          <span className={styles.statusLabel}>运行中:</span>
          <span className={styles.statusValue}>{iface.running ? '是' : '否'}</span>
        </span>
        <span className={styles.statusItem}>
          <span className={styles.statusLabel}>从属:</span>
          <span className={styles.statusValue}>否</span>
        </span>
        <span className={styles.statusItem}>
          <span className={styles.statusLabel}>运行 AP:</span>
          <span className={styles.statusValue}>{iface.mode === 'ap-bridge' ? '是' : '否'}</span>
        </span>
      </div>
    </div>
  );
};
