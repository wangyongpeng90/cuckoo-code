/** About 页（React 版，对齐原版） */
import { createElement, useState, useEffect, useCallback } from 'react';
import { api } from '../shared.js';
import { DonationBlock } from './donation-block.js';

export function AboutPage() {
  const [version, setVersion] = useState('—');
  const [qqUrl, setQqUrl] = useState('');

  useEffect(() => {
    const anyApi = api as any;
    if (anyApi.getAppInfo) {
      anyApi.getAppInfo().then((r: any) => { if (r && r.success) setVersion(r.version || '—'); }).catch(() => {});
    }
    if (anyApi.getAssetUrl) {
      anyApi.getAssetUrl('assets/qq-group.jpg').then((r: any) => { if (r && r.success) setQqUrl(r.url); }).catch(() => {});
    }
  }, []);

  const openGithub = useCallback(() => {
    const anyApi = api as any;
    if (anyApi.openExternal) anyApi.openExternal('https://github.com/wangyongpeng90/cuckoo-code');
  }, []);

  return createElement('div', { className: 'ck-tab ck-tab-active' },
    createElement('div', { className: 'ck-about-head' },
      createElement('div', { className: 'ck-about-logo' }, 'C'),
      createElement('div', { className: 'ck-about-title' }, 'Cuckoo Code'),
      createElement('div', { className: 'ck-about-ver' }, '版本 ', createElement('span', null, version)),
    ),
    createElement(DonationBlock, null),
    createElement('div', { className: 'ck-about-group' },
      createElement('div', { className: 'ck-about-group-title' }, '开源地址'),
      createElement('p', { className: 'ck-about-tip' }, '本系统为开源项目，欢迎点 Star 支持。'),
      createElement('a', { className: 'ck-about-link', onClick: openGithub }, 'github.com/wangyongpeng90/cuckoo-code'),
    ),
    createElement('div', { className: 'ck-about-group' },
      createElement('div', { className: 'ck-about-group-title' }, 'QQ 群：1104042537'),
      qqUrl ? createElement('img', { className: 'ck-about-qr', src: qqUrl, alt: 'QQ 群' }) : null,
    ),
  );
}
