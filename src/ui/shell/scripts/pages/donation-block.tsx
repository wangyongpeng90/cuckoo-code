/**
 * 捐赠与支持区块（共用组件）
 *
 * 在 About 页和 Token 页各展示一份。
 * 样式复用 components.css 里的 ck-about-* 系列。
 */
import { createElement } from 'react';
import { api } from '../shared.js';

function openUrl(url: string) {
  const anyApi = api as any;
  if (anyApi.openExternal) anyApi.openExternal(url);
}

export function DonationBlock() {
  return createElement('div', { className: 'ck-about-group' },
    createElement('div', { className: 'ck-about-group-title' }, '捐赠与支持'),
    // 明确：不收个人款，只引导向壹基金公益捐赠
    createElement('p', { className: 'ck-about-tip' },
      createElement('strong', null, '🚫 本项目不接受任何形式的个人捐赠'),
      ' —— 作者不会收取任何款项。',
    ),
    createElement('p', { className: 'ck-about-tip' },
      '✅ 如果你想支持本项目，欢迎向 ',
      createElement('strong', null, '壹基金（One Foundation）'),
      ' 捐赠：',
    ),
    createElement('a', { className: 'ck-about-link', onClick: () => openUrl('https://onefoundation.cn/donate/') }, 'onefoundation.cn/donate'),
    createElement('p', { className: 'ck-about-tip' }, '所有捐赠款项直接进入壹基金公益账户，与作者无关，纯属公益行为。'),
    // 权益说明：必须凭壹基金捐赠证书领取
    createElement('p', { className: 'ck-about-tip', style: { marginTop: '10px' } },
      createElement('strong', null, '捐赠者权益'),
      '（凭壹基金捐赠证书联系作者获取）：',
    ),
    createElement('p', { className: 'ck-about-tip' }, '· 深度定制开发'),
    createElement('p', { className: 'ck-about-tip' }, '· 单独社区群聊'),
    createElement('p', { className: 'ck-about-tip' }, '· 优先咨询服务'),
    // 联系方式
    createElement('p', { className: 'ck-about-tip', style: { marginTop: '10px' } },
      '💝 完成壹基金捐赠后，保存证书链接，联系作者（注明「',
      createElement('strong', null, 'Cuckoo 捐赠'),
      '」），会为你登记入捐赠者名单并拉入权益通道：',
    ),
    createElement('p', { className: 'ck-about-tip' }, 'QQ：61519628'),
    createElement('p', { className: 'ck-about-tip' }, '微信：w_y_p666'),
    createElement('p', { className: 'ck-about-tip' }, '邮箱：wangyongpeng@yongpeng.wang'),
    createElement('a', { className: 'ck-about-link', onClick: () => openUrl('https://github.com/wangyongpeng90/cuckoo-code/blob/master/DONORS.md') }, '查看完整捐赠者名单(github)'),
    createElement('br'),
    createElement('a', { className: 'ck-about-link', onClick: () => openUrl('https://docs.qq.com/smartsheet/DVWJoUkZVWHhzRVJw?tab=tkcqiO') }, '查看完整捐赠者名单(免梯链接)'),
  );
}
