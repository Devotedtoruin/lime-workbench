// ledger-keywords.js — 记账关键词与收支判定引擎（纯函数，可单测）
//
// 设计依据（调研了随手记 / 钱迹 / MOZE / 蜜蜂记账 的分类体系）：
//   1. 先判「收入还是支出」（L1 极性），再判「属于哪一类」（L3 分类）。
//      顺序不能反：「卖水果收入 100」如果先匹配分类会命中「水果」→ 餐饮 → 支出。
//   2. 长词优先。中文没有词边界，单字规则会污染一切：
//      「水费」必须整体匹配，绝不能为「水」建规则，否则「水果」「奶茶」全错。
//   3. 强特征词直接定类，不再走通用匹配：
//      「外卖」含「卖」但一定是支出；「猫粮」含「粮」但不是吃饭。
//   4. 永不猜。低置信度时返回候选，让用户选一次并记住。

/** 分类定义：id → { label, icon }。label 会存进账目记录。 */
export const LEDGER_CATEGORIES = {
  food: { label: '🍚 吃饭', icon: 'coffee' },
  drink: { label: '🥤 饮品', icon: 'coffee' },
  transport: { label: '🚇 交通', icon: 'bike' },
  housing: { label: '🏠 居住', icon: 'house' },
  shopping: { label: '🛍 购物', icon: 'wallet' },
  digital: { label: '💻 数码', icon: 'wallet' },
  fun: { label: '🎮 娱乐', icon: 'goal' },
  sport: { label: '🏃 运动健身', icon: 'dumbbell' },
  subscription: { label: '🔁 订阅服务', icon: 'repeat' },
  income: { label: '💼 收入', icon: 'wallet-cards' },
  medical: { label: '🏥 医疗', icon: 'circle-alert' },
  study: { label: '📚 学习', icon: 'book-open' },
  social: { label: '🎁 人情往来', icon: 'sparkles' },
  care: { label: '💇 生活服务', icon: 'person-standing' },
  pet: { label: '🐾 宠物', icon: 'leaf' },
  fixed: { label: '💳 固定支出', icon: 'calendar-clock' },
  daily: { label: '🔌 日用', icon: 'zap' },
  travel: { label: '✈️ 差旅', icon: 'map-pin' },
  misc: { label: '📦 杂项', icon: 'inbox' },
  other: { label: '🎁 其他', icon: 'tags' }
};

/** UI 渲染用的分类标签列表（保持稳定顺序） */
export const CATEGORIES = Object.values(LEDGER_CATEGORIES).map(c => c.label);

export function categoryIcon(label) {
  const hit = Object.values(LEDGER_CATEGORIES).find(c => c.label === label);
  return hit ? hit.icon : 'tags';
}

/* ============================================================
 * L1：收支极性
 * ============================================================ */

/** 收入信号：赚 / 卖 / 收 + 常见收入名词 */
const INCOME_VERBS = /(赚了|赚到|赚取|净赚|挣了|挣到|收到|收了|收款|收账|收租|入账|到账|进账|到款|发工资|发薪|报销下来|报销到账|报销款|退款|退货|退钱|退回|退押金|押金退回|返现|返利|返还|中奖|卖出|卖出去|卖了|卖掉|出售|转卖|变卖|售出|出手|变现|回收|分红|派息|结息|理赔|赔付|赔偿|打款给我|转给我|给我转|收红包|收到红包|抢红包|结款|回款|结算|外快|私活|稿费|版税|兼职收入|副业收入|营业收入|销售收入|卖货收入|变卖收入)/;

/** 支出信号：花 / 付 / 买 / 交 / 充 + 常见支出动词 */
const EXPENSE_VERBS = /(花了|花掉|花销|付了|付款|支付|买单|结了账|买了|购入|入手|交了|缴了|缴费|缴纳|充了|充值|续费|订阅|请客|垫付|垫了|先垫|罚款|罚了|扣款|扣了|消费|下单|刷了|用了|捐了|捐赠|打赏|包了|预订|定了)/;

/**
 * 需要排除的「假收入」：「收快递」「收衣服」「收外卖」里的「收」不是收款。
 * 「外卖」里的「卖」也不是卖出。
 */
const FALSE_INCOME = /(收快递|收衣服|收外卖|收货|收据|收件|收包裹|收行李|外卖|买卖|卖力|卖惨)/;

/** 收入类名词（不需要动词也能判为收入） */
const INCOME_NOUNS = /(工资|薪水|月薪|底薪|薪资|薪酬|年终奖|十三薪|绩效奖金|加班费|值班费|补贴|津贴|提成|佣金|全勤奖|利息|股息|股利|基金收益|理财收益|投资收益|房租收入|租金收入|红包|压岁钱|礼金|份子钱收回|报销款|理赔款|赔付|退款|退押金|中奖|彩票|稿费|版税|设计费|外包费|咨询费|讲课费|出场费|拆迁款|补偿金|收入|进账|营收|营业额|流水)/;

/** 支出类名词（不需要动词也能判为支出） */
const EXPENSE_NOUNS = /(房租|租金|房贷|月供|水费|电费|燃气费|物业费|取暖费|暖气费|宽带|网费|话费|流量费|停车费|过路费|高速费|油费|加油|保养|年检|车险|保费|保险|社保|公积金|个税|所得税|手续费|滞纳金|违约金|学费|报名费|教材费|挂号费|医药费|体检费|疫苗|罚款|罚单|会员费|年费|月租|快递费|运费|邮费|打印费|中介费|服务费|家政费|保洁费|停车|车费|机票|火车票|高铁票|船票|门票|住宿费|房费|餐费|外卖费|配送费|小费|份子|随礼|随份子|礼金|彩礼|帛金|香火钱|功德箱|白事|丧事|殡葬|花圈|墓地|纸钱|香烛)/;

/**
 * 判定一句话的收支极性。
 * @returns {{polarity:'income'|'expense', confidence:number, reason:string}}
 */
export function detectPolarity(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase();

  // 「外卖」「收快递」这类固定词先剔除，避免被「卖」「收」误判。
  const cleaned = t.replace(FALSE_INCOME, ' ');

  const hasIncomeVerb = INCOME_VERBS.test(cleaned);
  const hasExpenseVerb = EXPENSE_VERBS.test(cleaned);
  const hasIncomeNoun = INCOME_NOUNS.test(cleaned);
  const hasExpenseNoun = EXPENSE_NOUNS.test(cleaned);

  // 双信号冲突：谁的位置更靠后谁说了算（中文语序里结论通常在最后）。
  if (hasIncomeVerb && hasExpenseVerb) {
    const incomeAt = cleaned.search(INCOME_VERBS);
    const expenseAt = cleaned.search(EXPENSE_VERBS);
    const income = incomeAt > expenseAt;
    return { polarity: income ? 'income' : 'expense', confidence: 0.6,
      reason: income ? '收入动词在支出动词之后' : '支出动词在收入动词之后' };
  }

  if (hasIncomeVerb) return { polarity: 'income', confidence: 0.92, reason: '命中收入动词（赚/卖/收等）' };
  if (hasIncomeNoun && !hasExpenseNoun) {
    return { polarity: 'income', confidence: 0.8, reason: '命中收入类名词' };
  }
  if (hasExpenseVerb) return { polarity: 'expense', confidence: 0.9, reason: '命中支出动词（花/付/买/交等）' };
  if (hasExpenseNoun) return { polarity: 'expense', confidence: 0.82, reason: '命中支出类名词' };

  // 都没命中：记账场景里支出占绝大多数，默认支出但置信度低。
  return { polarity: 'expense', confidence: 0.4, reason: '无明确收支信号，按支出处理' };
}

/* ============================================================
 * L2：强特征词 —— 命中即定类，不参与通用匹配
 * ============================================================ */

const STRONG_FEATURES = [
  // 器材类后缀 + 运动词 = 买东西，不是运动记录。
  // 「跑步机」是购物，「跑步」才是运动，必须排在运动规则前面。
  { re: /跑步机|动感单车机|健身器材|哑铃套装|划船机|椭圆机|综合训练器/, cat: 'shopping' },
  // 「外卖」含「卖」，但一定是支出，且属于吃饭
  { re: /外卖|美团外卖|饿了么|点餐|配送费|宅急送|肯德基|麦当劳|华莱士|汉堡王|必胜客|塔斯汀/, cat: 'food' },
  // 宠物优先于「粮」「药」「疫苗」等通用词
  { re: /猫粮|狗粮|猫砂|猫条|狗零食|猫罐头|狗罐头|冻干|猫爬架|猫抓板|狗窝|猫窝|牵引绳|宠物|毛孩子|驱虫|绝育|猫三联|犬四联|宠物医院|宠物美容|宠物寄养|拾便袋|猫砂盆/, cat: 'pet' },
  // 健身补剂与健身房优先，但「跑步机」这类器材是购物（见下方 SHOPPING_FIRST）
  { re: /蛋白粉|乳清|肌酸|增肌粉|氮泵|左旋肉碱|代餐|能量胶|健身房|健身卡|私教|瑜伽|普拉提|动感单车|拳击|搏击|马拉松|越野赛|羽毛球|网球场|篮球场|足球场|乒乓球|瑜伽垫|哑铃|杠铃|壶铃|弹力带|跳绳|泳镜|泳衣|跑鞋|速干衣|瑜伽裤|运动手环/, cat: 'sport' },
  // 订阅制服务优先于「会员」「包」
  { re: /会员|订阅|续费|自动续费|包月|包年|vip|svip|大会员|plus会员|云盘|网盘|icloud|iCloud|软件订阅|年费/, cat: 'subscription' },
  // 水费/电费/燃气必须整体识别，绝不能落到「水」
  { re: /水费|电费|燃气费|天然气|煤气费|物业费|取暖费|暖气费|供暖费|水表|电表|燃气表|水卡|电卡/, cat: 'housing' },
  // 交通专有词
  { re: /加油|汽油|柴油|中石化|中石油|充电桩|停车费|过路费|高速费|etc|ETC|违章|罚单|年检|4S店|洗车|换轮胎/, cat: 'transport' },
  // 数码优先于「包」「膜」等
  { re: /手机|iphone|iPhone|华为|小米|红米|oppo|OPPO|vivo|荣耀|一加|realme|三星|电脑|笔记本|macbook|MacBook|平板|ipad|iPad|显示器|键盘|鼠标|显卡|相机|镜头|耳机|airpods|AirPods|音箱|音响|电视|冰箱|洗衣机|空调|微波炉|电饭煲|扫地机器人|投影仪|充电宝|移动电源|硬盘|u盘|U盘|kindle|Kindle|打印机|手机壳|钢化膜|数据线|充电器|扩展坞|三脚架|云台|自拍杆/, cat: 'digital' },
  // 饮品优先于「水」「茶」
  { re: /奶茶|咖啡|拿铁|美式|卡布|星巴克|瑞幸|luckin|喜茶|奈雪|蜜雪|茶百道|古茗|沪上阿姨|库迪|manner|果茶|柠檬茶|可乐|雪碧|汽水|酸奶|豆浆|coffee|latte|tea|milk tea|espresso|americano/, cat: 'drink' },
  // 生活服务
  { re: /理发|剪发|剪头发|洗剪吹|烫发|染发|美发|做头发|美甲|美睫|纹眉|医美|水光|光子嫩肤|按摩|足疗|足浴|推拿|spa|SPA|采耳|拔罐|刮痧|艾灸|洗衣|干洗|打印|复印|彩印|证件照|配镜|验光|眼镜|共享充电宝|跑腿|代购|中介费/, cat: 'care' },
  // 差旅
  { re: /出差|差旅|住宿费|酒店|民宿|机票|航班|高铁|动车|火车票|12306|登机/, cat: 'travel' },
  // 医疗
  { re: /挂号|门诊|看病|就诊|急诊|输液|打针|住院|手术|复查|买药|药店|药房|处方药|感冒药|退烧药|消炎药|体检|化验|血常规|CT|核磁|B超|胃镜|牙科|补牙|拔牙|洗牙|种植牙|正畸|牙套|口腔|疫苗|接种|九价|HPV|保健品|维生素|钙片|益生菌/, cat: 'medical' },
  // 学习
  { re: /买书|书籍|图书|当当|新华书店|教材|教辅|真题|习题|网课|课程|买课|报课|训练营|知识付费|得到|极客时间|慕课|培训|辅导班|补习|家教|学而思|新东方|猿辅导|考研|雅思|托福|报名费|考试费|考证|四六级|公务员|教师资格|驾照|驾校|文具|打印纸/, cat: 'study' },
  // 人情往来（含小众的白事、宗教捐赠）
  { re: /份子钱|随礼|随份子|礼金|彩礼|嫁妆|贺礼|喜酒|婚宴|满月酒|升学宴|乔迁|礼物|送礼|生日礼物|情人节|纪念日|伴手礼|请客|买单|招待|宴请|孝敬|给爸妈|给父母|养老|赡养|捐款|捐赠|慈善|公益|水滴筹|白事|丧事|殡葬|葬礼|追悼|帛金|花圈|墓地|扫墓|祭祖|上坟|纸钱|香烛|香火钱|功德箱|香油钱|寺庙|道观|布施|放生/, cat: 'social' }
];

/* ============================================================
 * L3：通用分类关键词（长词优先）
 * ============================================================ */

const GENERAL_KEYWORDS = [
  [/房租|租金|月租|押一付|押二付|租房|房东|合租|转租|房贷|按揭|月供|装修|翻新|疏通|换锁|家电维修|家具|沙发|床垫|衣柜|桌椅|灯具|窗帘|地毯|收纳|置物架|四件套|被子|枕头|厨具|锅碗|餐具|保洁|家政|钟点工|开荒|除螨|消杀/, 'housing'],
  [/早餐|早饭|早点|油条|包子|馒头|煎饼|肠粉|粥铺|面馆|米粉|小笼包|生煎|午餐|午饭|中饭|工作餐|快餐|盒饭|便当|盖饭|黄焖鸡|沙县|兰州拉面|晚餐|晚饭|夜宵|宵夜|烧烤|火锅|串串|麻辣烫|小龙虾|烤肉|日料|寿司|聚餐|下馆子|饭局|食堂|饭卡|餐卡|水果|苹果|香蕉|橙子|橘子|西瓜|葡萄|草莓|蓝莓|车厘子|榴莲|芒果|菠萝|猕猴桃|火龙果|百香果|果切|零食|薯片|饼干|巧克力|糖果|坚果|瓜子|辣条|冰淇淋|雪糕|蛋挞|蛋糕|面包|甜品|泡面|方便面|买菜|菜市场|菜场|生鲜|蔬菜|猪肉|牛肉|羊肉|排骨|海鲜|鱼虾|鸡蛋|粮油|盒马|叮咚|朴朴|多多买菜|永辉|大润发|山姆|costco|超市|便利店|全家|罗森|711|7-11|香烟|买烟|啤酒|白酒|红酒|洋酒|威士忌|清酒|酒水/, 'food'],
  [/地铁|公交|巴士|轻轨|有轨电车|一卡通|交通卡|乘车码|轮渡|船票|打车|出租车|的士|网约车|滴滴|高德打车|花小猪|曹操出行|T3出行|顺风车|拼车|代驾|共享单车|哈啰|哈罗|美团单车|青桔|摩拜|骑行卡|助力车|共享电单车|长途汽车|大巴|客车|磁悬浮|车辆养护|车贷|车船税/, 'transport'],
  [/话费|充话费|手机费|电话费|移动|联通|电信|流量|套餐|宽带|光纤|网费|路由器|光猫|邮费|邮寄|寄件|快递费|运费|顺丰|圆通|中通|申通|韵达|极兔|邮政|EMS|菜鸟|驿站|丰巢/, 'daily'],
  [/衣服|裤子|裙子|外套|大衣|羽绒服|卫衣|衬衫|T恤|毛衣|内衣|袜子|帽子|围巾|手套|球鞋|运动鞋|皮鞋|靴子|拖鞋|包包|背包|双肩包|钱包|皮带|首饰|项链|戒指|耳环|手表|墨镜|太阳镜|优衣库|zara|H&M|nike|耐克|阿迪|adidas|李宁|安踏|化妆品|护肤|面霜|精华|水乳|面膜|口红|粉底|眼影|睫毛膏|卸妆|洗面奶|防晒|香水|洗发水|沐浴露|牙膏|牙刷|卫生巾|纸巾|抽纸|湿巾|洗手液|护手霜|身体乳|剃须|吹风机|屈臣氏|丝芙兰|日用品|洗衣液|洗衣粉|洗洁精|垃圾袋|保鲜膜|厨房纸|拖把|扫把|抹布|衣架|挂钩|雨伞|雨衣|水杯|保温杯|饭盒|电池|灯泡|插座|插排|胶带|剪刀|指甲刀|棉签|口罩|消毒液|驱蚊|花露水|淘宝|天猫|京东|拼多多|唯品会|抖音商城|直播间|下单|奶粉|尿不湿|纸尿裤|辅食|奶瓶|婴儿|宝宝|儿童|玩具|童装|早教/, 'shopping'],
  [/电影|影票|影院|万达影城|猫眼|淘票票|演出|演唱会|音乐节|话剧|舞台剧|展览|博物馆|美术馆|漫展|门票|游戏|氪金|皮肤|抽卡|十连|steam|Steam|PSN|switch|Switch|王者|原神|和平精英|英雄联盟|点券|游戏币|月卡|旅游|旅行|度假|携程|去哪儿|飞猪|马蜂窝|景区|迪士尼|环球影城|跟团|自由行|青旅|露营|KTV|酒吧|夜店|清吧|棋牌|麻将|台球|桌游|剧本杀|密室|钓鱼|摄影|乐器|吉他|钢琴|绘画|手办|模型|乐高|汉服|手账|打赏|刷礼物|舰长|提督|充电|催更/, 'fun'],
  [/保险|保费|车险|重疾险|医疗险|意外险|寿险|年金险|社保|医保|公积金|个税|所得税|契税|印花税|房产税|报税|利息|分期手续费|花呗分期|信用卡利息|罚息|手续费|提现费|跨行费|转账费|账户管理费|违约金|贷款|还款|花呗|信用卡|虚拟货币|数字货币|比特币|BTC|以太坊|ETH|USDT|买币|充U|交易所|币安|欧易|OKX|矿机|挖矿|NFT|Web3/, 'fixed'],
  [/捐款|捐赠|慈善|公益|爱心|义卖/, 'social'],
  [/快递|运费|跑腿|代购|物流|杂项|其他/, 'misc']
];

/** 把规则表展开成 {cat, kw, len} 并按长度降序，实现长词优先。 */
const FLAT_RULES = (() => {
  const out = [];
  const push = (re, cat) => {
    const source = re.source;
    // 取出所有不含正则元字符的纯中文/字母词作为可比较的字面量。
    for (const part of source.split('|')) {
      if (/^[\p{Script=Han}A-Za-z0-9]+$/u.test(part)) out.push({ cat, kw: part, len: part.length });
    }
  };
  for (const [re, cat] of GENERAL_KEYWORDS) push(re, cat);
  return out.sort((a, b) => b.len - a.len);
})();

/**
 * 判断文本属于哪个分类。
 * @param {string} text
 * @param {'income'|'expense'} polarity
 * @returns {{cat:string, confidence:number, matched:string|null}}
 */
export function detectCategory(text, polarity = 'expense') {
  const t = String(text || '').toLowerCase();

  if (polarity === 'income') {
    // 收入再细分：工资 / 变卖 / 报销退款 / 人情 / 理财
    if (/工资|薪水|月薪|底薪|薪资|薪酬|发薪|加班费|值班费|绩效|提成|佣金|全勤奖|年终奖|十三薪|项目奖金|季度奖|补贴|津贴/.test(t)) {
      return { cat: 'income', confidence: 0.95, matched: '工资薪酬' };
    }
    if (/卖出|卖了|卖掉|出售|转卖|变卖|售出|出手|变现|回收|闲鱼|转转|以旧换新/.test(t)) {
      return { cat: 'income', confidence: 0.95, matched: '二手变卖' };
    }
    if (/报销|退款|退货|退回|返现|返利|返还|理赔|赔付|赔偿|价保|补差价|押金/.test(t)) {
      return { cat: 'income', confidence: 0.93, matched: '报销退款' };
    }
    if (/红包|压岁钱|礼金|份子钱|收礼|彩礼|父母给|爸妈给|家里给|生活费|零花钱/.test(t)) {
      return { cat: 'social', confidence: 0.9, matched: '人情收入' };
    }
    if (/利息|股息|分红|派息|股利|基金收益|理财收益|投资收益|结息|收租|租金收入/.test(t)) {
      return { cat: 'income', confidence: 0.92, matched: '投资收益' };
    }
    if (/稿费|版税|版权费|设计费|外包费|咨询费|讲课费|出场费|兼职|副业|外快|私活|接单|跑腿|摆摊|家教/.test(t)) {
      return { cat: 'income', confidence: 0.9, matched: '兼职外快' };
    }
    if (/中奖|彩票|刮刮乐|抽中|捡到|意外所得|拆迁款|补偿金/.test(t)) {
      return { cat: 'income', confidence: 0.85, matched: '意外所得' };
    }
    return { cat: 'income', confidence: 0.7, matched: null };
  }

  // 支出：强特征优先
  for (const rule of STRONG_FEATURES) {
    if (rule.re.test(t)) return { cat: rule.cat, confidence: 0.93, matched: '强特征词' };
  }

  // 通用关键词：长词优先（已按长度降序排好）
  for (const rule of FLAT_RULES) {
    if (t.includes(rule.kw)) return { cat: rule.cat, confidence: 0.85, matched: rule.kw };
  }

  return { cat: 'other', confidence: 0.3, matched: null };
}

/* ============================================================
 * 金额抽取
 * ============================================================ */

/** 需要从金额候选里剔除的「假数字」：型号、数量、时间、日期。 */
const NOISE_NUMBER = [
  // iPhone15、A4 —— 但不能吃掉小数（coffee 4.5 里的 4.5 必须保留）
  /[A-Za-z]\s*\d+(?!\.\d)/g,
  // 日期：2026-10-30 / 2026/10/30 / 10月30日
  /\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}\s*日?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/g,
  /\d+\s*(?:公里|千米|号线|楼|层|岁|人|个|件|杯|份|次|天|周|月|年|小时|分钟|秒|步|ml|毫升|g|kg|GB|MB|TB)/gi,
  /(?:第|周|星期|礼拜)\s*\d+/g,
  /\d{1,2}\s*[:：]\s*\d{2}/g                            // 15:30
];

/**
 * 从一句话里抽出金额。
 * 优先级：显式货币单位 > 剔除噪音后的数字。
 * @returns {{amount:number|null, confidence:number}}
 */
export function extractAmount(text) {
  const raw = String(text || '');
  const cleaned = NOISE_NUMBER.reduce((acc, re) => acc.replace(re, ' '), raw);

  // 1) 带货币单位：¥50 / 50元 / 50块 / 50块钱
  const withUnit = /(?:[¥￥]\s*(\d+(?:\.\d+)?))|(?:(\d+(?:\.\d+)?)\s*(?:元|块钱|块|圆|rmb))/i.exec(cleaned);
  if (withUnit) {
    const value = Number(withUnit[1] || withUnit[2]);
    if (Number.isFinite(value) && value > 0) return { amount: value, confidence: 0.98 };
  }

  // 2) 万 / k 单位（\b 对中文无效，因此用「后面不是数字」来界定边界）
  const scaled = /(\d+(?:\.\d+)?)\s*(万|w|k|千)(?![\d])/i.exec(cleaned);
  if (scaled) {
    const base = Number(scaled[1]);
    const unit = scaled[2].toLowerCase();
    const value = base * (unit === '万' || unit === 'w' ? 10000 : 1000);
    if (Number.isFinite(value) && value > 0) return { amount: value, confidence: 0.9 };
  }

  // 3) 中文数字金额：三百、五十、一百五、一千五、一万五
  const cn = /([零一二两三四五六七八九十百千万亿]+)\s*(?:元|块钱|块)/.exec(cleaned);
  if (cn) {
    const value = chineseNumber(cn[1]);
    if (value > 0) return { amount: value, confidence: 0.88 };
  }

  // 4) 兜底：剔除噪音后剩下的最大数字
  const numbers = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)]
    .map(m => Number(m[0]))
    .filter(n => Number.isFinite(n) && n > 0 && n < 1_000_000_000);
  if (numbers.length) return { amount: Math.max(...numbers), confidence: 0.6 };

  return { amount: null, confidence: 0 };
}

/** 中文数字 → 阿拉伯数字（支持「一百五」「一千五」「一万五」这类省略尾数的说法） */
export function chineseNumber(text) {
  const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const SMALL_UNITS = { 十: 10, 百: 100, 千: 1000 };
  const BIG_UNITS = { 万: 10000, 亿: 100000000 };
  const s = String(text || '').replace(/两/g, '二');
  if (!s) return 0;
  let total = 0, section = 0, number = 0;
  let lastSmallUnit = 0;       // 最近一个十/百/千，用于口语省略补位
  let lastBigUnit = 0;         // 最近一个万/亿
  let afterZero = false;       // 末尾数字前是否出现过「零」

  for (const ch of s) {
    if (ch in DIGITS) {
      number = DIGITS[ch];
      afterZero = ch === '零' ? true : afterZero;
      continue;
    }
    const small = SMALL_UNITS[ch];
    if (small) {
      section += (number || 1) * small;
      number = 0;
      lastSmallUnit = small;
      lastBigUnit = 0;
      afterZero = false;
      continue;
    }
    const big = BIG_UNITS[ch];
    if (big) {
      total += (section + number || 1) * big;
      section = 0;
      number = 0;
      lastBigUnit = big;
      lastSmallUnit = 0;
      afterZero = false;
    }
  }

  // 口语省略：末尾只剩一个数字、前面没有「零」、并且最近用到过百/千/万/亿时，
  // 这个数字代表下一档。例：一百五=150、一千五=1500、一万五=15000。
  if (number > 0 && !afterZero && (lastSmallUnit || lastBigUnit)) {
    const unit = lastSmallUnit || lastBigUnit;
    if (unit >= 100) {
      section += number * (unit / 10);
      number = 0;
    }
  }
  return total + section + number;
}

/* ============================================================
 * 对外主入口
 * ============================================================ */

/**
 * 是否具备「明确的记账意图」。
 *
 * 光有数字不算记账：「项目123」「第2期报告」「abc 123」都不该被静默记成支出。
 * 必须有货币单位、收支动词，或者一个能识别的消费名词。
 */
export function hasLedgerIntent(text) {
  const t = String(text || '');
  // 1) 明确的货币标记
  if (/[¥￥]/.test(t)) return true;
  if (/\d+(?:\.\d+)?\s*(?:元|块钱|块|圆|rmb)/i.test(t)) return true;
  // 2) 明确的收支动词
  if (INCOME_VERBS.test(t) || EXPENSE_VERBS.test(t)) return true;
  // 3) 明确的收支名词
  if (INCOME_NOUNS.test(t) || EXPENSE_NOUNS.test(t)) return true;
  // 4) 强特征消费词
  if (STRONG_FEATURES.some(rule => rule.re.test(t.toLowerCase()))) return true;
  // 5) 通用分类词（需要是非单字的实义词）
  const lower = t.toLowerCase();
  if (FLAT_RULES.some(rule => rule.len >= 2 && lower.includes(rule.kw))) return true;
  return false;
}

/**
 * 这句话看起来是生活记录（步数/饮水/运动/学习），而不是记账。
 * 由调用方决定是否交给生活记录模块，避免「走了 6000 步」被记成 6000 元。
 */
export function looksLikeLifeLog(text) {
  const t = String(text || '');
  if (/步数|steps?|\d+\s*步/i.test(t) && !/(元|块|¥|￥|rmb)/i.test(t)) return true;
  if (/喝(?:了)?|饮水|补水/.test(t) && /(ml|毫升|杯)/i.test(t) && !/(元|块|¥|￥)/i.test(t)) return true;
  if (/(跑步|走路|骑行|游泳|健身|瑜伽|徒步|运动)/.test(t) &&
      /(分钟|小时|公里|km|min)/i.test(t) && !/(元|块|¥|￥|花了|付了|买了)/i.test(t)) return true;
  if (/(学习|看书|专注|自习)/.test(t) && /(分钟|小时)/i.test(t) && !/(元|块|¥|￥)/i.test(t)) return true;
  return false;
}

/**
 * 解析一句记账话术。
 * @returns {{type, amount, cat, note, confidence, needClarify, candidates}|null}
 *   金额识别不到、或没有记账意图时返回 null，让 UI 走兜底。
 */
export function parseLedgerPhrase(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // 生活记录优先：避免把步数/饮水量当成金额。
  if (looksLikeLifeLog(raw)) return null;

  // 没有记账意图的裸数字不记：「项目123」不是花了 123 元。
  if (!hasLedgerIntent(raw)) return null;

  const { amount, confidence: amountConf } = extractAmount(raw);
  if (!amount) return null;

  const { polarity, confidence: polarityConf, reason } = detectPolarity(raw);
  const { cat, confidence: catConf, matched } = detectCategory(raw, polarity);

  const confidence = Math.round(((amountConf + polarityConf + catConf) / 3) * 100) / 100;
  const note = buildNote(raw, amount);

  const result = {
    type: polarity,
    amount,
    cat: LEDGER_CATEGORIES[cat].label,
    catId: cat,
    note,
    confidence,
    reason,
    matched
  };

  // 低置信度：给出候选让用户确认一次，而不是硬猜。
  if (confidence < 0.6) {
    result.needClarify = true;
    result.candidates = polarity === 'income'
      ? [LEDGER_CATEGORIES.income.label, LEDGER_CATEGORIES.social.label, LEDGER_CATEGORIES.other.label]
      : [LEDGER_CATEGORIES.food.label, LEDGER_CATEGORIES.daily.label, LEDGER_CATEGORIES.other.label];
  }
  return result;
}

/** 从原句里去掉金额和收支动词，留下可读备注。 */
export function buildNote(text, amount) {
  let note = String(text || '')
    .replace(/[¥￥]\s*\d+(?:\.\d+)?/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:元|块钱|块|圆|rmb)/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:万|w|k|千)/gi, ' ')
    .replace(/\d+(?:\.\d+)?/g, ' ')
    // 动词表按长度降序，避免「卖出去」被「卖」先截断成「去」。
    .replace(/(?:报销下来|报销到账|打款给我|转给我|给我转|收到红包|押金退回|兼职收入|副业收入|赚了|赚到|赚取|挣了|挣到|收到|收了|收款|收账|收租|入账|到账|进账|到款|发工资|发薪|退款|退货|退钱|退回|退押金|返现|返利|返还|中奖|卖出去|卖出|卖了|卖掉|出售|转卖|变卖|售出|出手|变现|回收|分红|派息|结息|理赔|赔付|赔偿|结款|回款|结算|花了|花掉|花销|付了|付款|支付|买单|结了账|买了|购入|入手|交了|缴了|缴费|缴纳|充了|充值|续费|订阅|请客|垫付|垫了|先垫|罚款|罚了|扣款|扣了|消费|下单|刷了|用了|捐了|捐赠|打赏|包了|预订|定了)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[的了在给和与]+/, '')
    .replace(/[的了]+$/, '')
    .trim();
  if (!note) note = '记一笔';
  return [...note].slice(0, 60).join('');
}
