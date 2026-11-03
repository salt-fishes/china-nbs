/**
 * Official NBS "主要城市年度" list (code=8).
 *
 * Source: /external/getDasByDaCatalogId?daCid=5772e42228f948149cf5d6a11d07bce1
 * Verified 2026-11-03. The API covers 36 cities:
 * - 4 municipalities (北京/天津/上海/重庆) are represented as provinces.
 * - 32 prefecture-level cities are listed here.
 *
 * Do not add arbitrary prefecture-level cities: the upstream dataset does not
 * publish city annual data for them.
 */
export const CITIES = [
  { text: '石家庄市', value: '130100000000', aliases: ['石家庄'], scope: 'city' },
  { text: '太原市', value: '140100000000', aliases: ['太原'], scope: 'city' },
  { text: '呼和浩特市', value: '150100000000', aliases: ['呼和浩特'], scope: 'city' },
  { text: '沈阳市', value: '210100000000', aliases: ['沈阳'], scope: 'city' },
  { text: '大连市', value: '210200000000', aliases: ['大连'], scope: 'city' },
  { text: '长春市', value: '220100000000', aliases: ['长春'], scope: 'city' },
  { text: '哈尔滨市', value: '230100000000', aliases: ['哈尔滨'], scope: 'city' },
  { text: '南京市', value: '320100000000', aliases: ['南京'], scope: 'city' },
  { text: '杭州市', value: '330100000000', aliases: ['杭州'], scope: 'city' },
  { text: '宁波市', value: '330200000000', aliases: ['宁波'], scope: 'city' },
  { text: '合肥市', value: '340100000000', aliases: ['合肥'], scope: 'city' },
  { text: '福州市', value: '350100000000', aliases: ['福州'], scope: 'city' },
  { text: '厦门市', value: '350200000000', aliases: ['厦门'], scope: 'city' },
  { text: '南昌市', value: '360100000000', aliases: ['南昌'], scope: 'city' },
  { text: '济南市', value: '370100000000', aliases: ['济南'], scope: 'city' },
  { text: '青岛市', value: '370200000000', aliases: ['青岛'], scope: 'city' },
  { text: '郑州市', value: '410100000000', aliases: ['郑州'], scope: 'city' },
  { text: '武汉市', value: '420100000000', aliases: ['武汉'], scope: 'city' },
  { text: '长沙市', value: '430100000000', aliases: ['长沙'], scope: 'city' },
  { text: '广州市', value: '440100000000', aliases: ['广州'], scope: 'city' },
  { text: '深圳市', value: '440300000000', aliases: ['深圳'], scope: 'city' },
  { text: '南宁市', value: '450100000000', aliases: ['南宁'], scope: 'city' },
  { text: '海口市', value: '460100000000', aliases: ['海口'], scope: 'city' },
  { text: '成都市', value: '510100000000', aliases: ['成都'], scope: 'city' },
  { text: '贵阳市', value: '520100000000', aliases: ['贵阳'], scope: 'city' },
  { text: '昆明市', value: '530100000000', aliases: ['昆明'], scope: 'city' },
  { text: '拉萨市', value: '540100000000', aliases: ['拉萨'], scope: 'city' },
  { text: '西安市', value: '610100000000', aliases: ['西安'], scope: 'city' },
  { text: '兰州市', value: '620100000000', aliases: ['兰州'], scope: 'city' },
  { text: '西宁市', value: '630100000000', aliases: ['西宁'], scope: 'city' },
  { text: '银川市', value: '640100000000', aliases: ['银川'], scope: 'city' },
  { text: '乌鲁木齐市', value: '650100000000', aliases: ['乌鲁木齐'], scope: 'city' },
] as const;
