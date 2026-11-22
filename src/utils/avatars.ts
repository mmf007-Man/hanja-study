export interface AvatarPreset {
  id: string;
  icon: string;
  label: string;
  color: string;
  bg: string;
}

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  {
    id: 'tiger',
    icon: '🐯',
    label: '호랑이',
    color: '#b45309',
    bg: '#fef3c7',
  },
  {
    id: 'rabbit',
    icon: '🐰',
    label: '토끼',
    color: '#be185d',
    bg: '#fce7f3',
  },
  {
    id: 'bear',
    icon: '🐻',
    label: '곰',
    color: '#92400e',
    bg: '#fde68a',
  },
  {
    id: 'fox',
    icon: '🦊',
    label: '여우',
    color: '#c2410c',
    bg: '#ffedd5',
  },
  {
    id: 'panda',
    icon: '🐼',
    label: '판다',
    color: '#334155',
    bg: '#e2e8f0',
  },
  {
    id: 'owl',
    icon: '🦉',
    label: '부엉이',
    color: '#4338ca',
    bg: '#e0e7ff',
  },
  {
    id: 'cat',
    icon: '🐱',
    label: '고양이',
    color: '#0f766e',
    bg: '#ccfbf1',
  },
  {
    id: 'puppy',
    icon: '🐶',
    label: '강아지',
    color: '#1d4ed8',
    bg: '#dbeafe',
  },
];

const FALLBACK_AVATAR: AvatarPreset = {
  id: 'default',
  icon: '🎓',
  label: '학습자',
  color: '#475569',
  bg: '#f1f5f9',
};

export function getAvatarPreset(avatarId: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === avatarId) ?? {
    ...FALLBACK_AVATAR,
    id: avatarId || FALLBACK_AVATAR.id,
  };
}
