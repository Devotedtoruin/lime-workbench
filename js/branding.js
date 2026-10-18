import { avatarOf } from './core.js';
import { isRasterDataUrl } from './appearance.js';

export const DEFAULT_WORKSPACE_NAME = '青柠工作台';
export const DEFAULT_BRAND_ICON = 'assets/brand.svg';

export function isAvatarImage(value) {
  return typeof value === 'string' && value.length <= 300_000 &&
    /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && !/[\r\n]$/.test(value);
}

export function workspaceNameOf(settings) {
  const name = typeof settings?.workspaceName === 'string' ? settings.workspaceName.trim() : '';
  return name || DEFAULT_WORKSPACE_NAME;
}

// 保留导出以兼容旧备份读取，界面层已统一使用 avatarOf(settings) 展示个人头像，不再暴露「独立 Logo」设置。
export function workspaceLogoOf(settings) {
  let logo = { kind: 'image', value: DEFAULT_BRAND_ICON };
  let assetId = '';
  if (settings?.logoMode === 'avatar') {
    const avatar = avatarOf(settings);
    if (avatar.kind === 'text' || isAvatarImage(avatar.value)) logo = avatar;
    assetId = settings.avatarAssetId;
  } else if (settings?.logoMode === 'custom') {
    if (isRasterDataUrl(settings.logoImage, 300_000)) logo = { kind: 'image', value: settings.logoImage };
    assetId = settings.logoAssetId;
  }
  if (typeof assetId === 'string' && /^[a-z0-9-]{1,80}$/.test(assetId) && !/[\r\n]$/.test(assetId)) {
    return { ...logo, assetId };
  }
  return logo;
}
