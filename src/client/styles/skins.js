/**
 * src/client/styles/skins.js — 五套 built-in 高定视觉主题引擎与全局“去直男化”视觉覆写层
 *
 * 【主题清单（支持 DSH 深色 + 浅色双宿主无缝适配）】
 *   - `glass`（默认）：晨雾琉璃空气感（Apple × Arc 半透明磨砂玻璃 + 大圆角 + 暮色微光晕）
 *   - `editorial`：温润纸感编辑室（Claude × Craft 暖木炭/羊皮纸 + 衬线书卷标题 + 细丝线）
 *   - `botanical`：静谧森系自然感（MUJI × Things 3 松烟青/和纸白 + 温和留白与圆点提示）
 *   - `starlight`：星夜幻想陪伴风（哈基米专属紫夜星金 + 樱粉点缀 + 星轨深浅层次）
 *   - `classic`：原生简约（中性克制适配，同样洗去刺眼工控红绿框与花哨彩虹对比）
 *
 * 【全局“去直男化”一致性收口】
 *   1. 将全面板页签（`.dnb-seg-btn`）、手风琴卡片（`.dnb-acc-card[data-tone]`）与自定义规则卡片（`.dnb-wall-box`）
 *      从高饱和工控霓虹描边/对角线强渐变收口为柔和 hairline 丝线与低饱和语义色；
 *   2. 统一柔和开关（`.dnb-switch`）、圆角尺度与轻量字重层级，提供随皮肤同步变形的思考深度控件样式，
 *      以及顶栏快捷换肤气泡（`.dnb-skin-pop`）和设置页 2 列主题卡片（`.dnb-skin-grid`）。
 */

export const CSS_SKINS = `
  /* ========================================================================
   * 1. Five Curated Built-In Themes (Dark Mode Base + Light Mode Expandable)
   * ======================================================================== */

  /* --- A. glass (Default): Apple x Arc Frosted Mist --- */
  html[data-dnb-skin="glass"],
  html[data-dnb-skin="glass"] .dnb-menu,
  html[data-dnb-skin="glass"] .dnb-modal-card,
  html[data-dnb-skin="glass"] .dnb-toast,
  .dnb-panel[data-dnb-skin="glass"] {
    --dnb-skin-bg: rgba(16, 18, 30, 0.94);
    --dnb-skin-ambient: radial-gradient(circle at 14% 8%, rgba(139, 124, 246, 0.16), transparent 44%), radial-gradient(circle at 86% 18%, rgba(88, 166, 255, 0.11), transparent 44%);
    --dnb-card: rgba(255, 255, 255, 0.068);
    --dnb-card-hover: rgba(255, 255, 255, 0.105);
    --dnb-surface-sub: rgba(13, 15, 26, 0.56);
    --dnb-head-tint: rgba(255, 255, 255, 0.04);
    --dnb-fill: rgba(255, 255, 255, 0.085);
    --dnb-elevated: rgba(34, 37, 56, 0.96);
    --dnb-popover: #1b1e31;
    --dnb-border: rgba(255, 255, 255, 0.15);
    --dnb-border-strong: rgba(255, 255, 255, 0.25);
    --dnb-text: #f3f5fc;
    --dnb-text-2: rgba(232, 236, 252, 0.76);
    --dnb-text-3: rgba(232, 236, 252, 0.50);
    --dnb-accent: #9f8eff;
    --dnb-accent-soft: rgba(159, 142, 255, 0.17);
    --dnb-primary-bg: #7c6bf2;
    --dnb-primary-bg-hover: #6c5ae8;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #63d1b0;
    --dnb-sage-soft: rgba(99, 209, 176, 0.14);
    --dnb-amber: #f3be6d;
    --dnb-amber-soft: rgba(243, 190, 109, 0.14);
    --dnb-coral: #f28b88;
    --dnb-coral-soft: rgba(242, 139, 136, 0.13);
    --dnb-switch-on: #5bc4a5;
    --dnb-switch-off: rgba(255, 255, 255, 0.18);
    --dnb-radius-panel: 22px;
    --dnb-radius-card: 15px;
    --dnb-radius-pill: 999px;
    --dnb-font-display: inherit;
    --dnb-skin-shadow: 0 22px 52px rgba(7, 9, 22, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="glass"],
  html[data-ds-theme-source="light"][data-dnb-skin="glass"],
  html[data-ds-theme-source="light"][data-dnb-skin="glass"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="glass"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="glass"] .dnb-toast {
    --dnb-skin-bg: #dde3ee;
    --dnb-skin-ambient: radial-gradient(circle at 12% 10%, rgba(111, 92, 232, 0.08), transparent 45%), radial-gradient(circle at 88% 20%, rgba(59, 130, 246, 0.07), transparent 45%);
    --dnb-card: #f2f5fa;
    --dnb-card-hover: #eaeff7;
    --dnb-surface-sub: #e6ebf4;
    --dnb-head-tint: rgba(58, 70, 102, 0.055);
    --dnb-fill: rgba(58, 70, 102, 0.085);
    --dnb-elevated: #f4f7fb;
    --dnb-popover: #f5f7fb;
    --dnb-border: rgba(58, 70, 102, 0.22);
    --dnb-border-strong: rgba(58, 70, 102, 0.34);
    --dnb-text: #161d31;
    --dnb-text-2: #3b4661;
    --dnb-text-3: #5b6682;
    --dnb-accent: #5e4bd8;
    --dnb-accent-soft: rgba(94, 75, 216, 0.12);
    --dnb-primary-bg: #5e4bd8;
    --dnb-primary-bg-hover: #4d3bc4;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #248569;
    --dnb-sage-soft: rgba(36, 133, 105, 0.12);
    --dnb-amber: #ab701f;
    --dnb-amber-soft: rgba(171, 112, 31, 0.12);
    --dnb-coral: #c44a4a;
    --dnb-coral-soft: rgba(196, 74, 74, 0.11);
    --dnb-switch-on: #2c9676;
    --dnb-switch-off: #bfc8db;
    --dnb-skin-shadow: 0 14px 36px rgba(42, 54, 92, 0.13), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }

  /* --- B. editorial: Claude x Craft Warm Paper Studio --- */
  html[data-dnb-skin="editorial"],
  html[data-dnb-skin="editorial"] .dnb-menu,
  html[data-dnb-skin="editorial"] .dnb-modal-card,
  html[data-dnb-skin="editorial"] .dnb-toast,
  .dnb-panel[data-dnb-skin="editorial"] {
    --dnb-skin-bg: #171412;
    --dnb-skin-ambient: none;
    --dnb-card: #24201c;
    --dnb-card-hover: #2d2824;
    --dnb-surface-sub: #1c1916;
    --dnb-head-tint: rgba(245, 232, 214, 0.045);
    --dnb-fill: rgba(245, 232, 214, 0.085);
    --dnb-elevated: #2e2925;
    --dnb-popover: #26221e;
    --dnb-border: rgba(245, 232, 214, 0.16);
    --dnb-border-strong: rgba(245, 232, 214, 0.28);
    --dnb-text: #f5efe6;
    --dnb-text-2: rgba(245, 239, 230, 0.76);
    --dnb-text-3: rgba(245, 239, 230, 0.48);
    --dnb-accent: #de825d;
    --dnb-accent-soft: rgba(222, 130, 93, 0.15);
    --dnb-primary-bg: #cf6e48;
    --dnb-primary-bg-hover: #bd5f3a;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #7aad8c;
    --dnb-sage-soft: rgba(122, 173, 140, 0.14);
    --dnb-amber: #d7af6b;
    --dnb-amber-soft: rgba(215, 175, 107, 0.14);
    --dnb-coral: #dd736a;
    --dnb-coral-soft: rgba(221, 115, 106, 0.13);
    --dnb-switch-on: #6fa381;
    --dnb-switch-off: rgba(245, 232, 214, 0.20);
    --dnb-radius-panel: 16px;
    --dnb-radius-card: 12px;
    --dnb-radius-pill: 8px;
    --dnb-font-display: Georgia, "Noto Serif SC", "Songti SC", serif;
    --dnb-skin-shadow: 0 20px 44px rgba(10, 7, 5, 0.44);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="editorial"],
  html[data-ds-theme-source="light"][data-dnb-skin="editorial"],
  html[data-ds-theme-source="light"][data-dnb-skin="editorial"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="editorial"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="editorial"] .dnb-toast {
    --dnb-skin-bg: #e4dcd0;
    --dnb-skin-ambient: none;
    --dnb-card: #f3eee5;
    --dnb-card-hover: #ece5d9;
    --dnb-surface-sub: #eae2d5;
    --dnb-head-tint: rgba(84, 65, 45, 0.055);
    --dnb-fill: rgba(84, 65, 45, 0.085);
    --dnb-elevated: #f5f0e8;
    --dnb-popover: #f5f0e8;
    --dnb-border: rgba(84, 65, 45, 0.22);
    --dnb-border-strong: rgba(84, 65, 45, 0.34);
    --dnb-text: #221b15;
    --dnb-text-2: #4b3f34;
    --dnb-text-3: #6c5d50;
    --dnb-accent: #b85632;
    --dnb-accent-soft: rgba(184, 86, 50, 0.12);
    --dnb-primary-bg: #b85632;
    --dnb-primary-bg-hover: #a14625;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #3f7352;
    --dnb-sage-soft: rgba(63, 115, 82, 0.115);
    --dnb-amber: #976d27;
    --dnb-amber-soft: rgba(151, 109, 39, 0.115);
    --dnb-coral: #b3473e;
    --dnb-coral-soft: rgba(179, 71, 62, 0.105);
    --dnb-switch-on: #4a805d;
    --dnb-switch-off: #ccc1b0;
    --dnb-skin-shadow: 0 12px 32px rgba(62, 44, 24, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  /* --- C. botanical: MUJI x Things 3 Quiet Forest --- */
  html[data-dnb-skin="botanical"],
  html[data-dnb-skin="botanical"] .dnb-menu,
  html[data-dnb-skin="botanical"] .dnb-modal-card,
  html[data-dnb-skin="botanical"] .dnb-toast,
  .dnb-panel[data-dnb-skin="botanical"] {
    --dnb-skin-bg: #111614;
    --dnb-skin-ambient: none;
    --dnb-card: #1b2320;
    --dnb-card-hover: #222c28;
    --dnb-surface-sub: #151b18;
    --dnb-head-tint: rgba(218, 232, 223, 0.045);
    --dnb-fill: rgba(218, 232, 223, 0.085);
    --dnb-elevated: #252f2b;
    --dnb-popover: #1e2622;
    --dnb-border: rgba(218, 232, 223, 0.15);
    --dnb-border-strong: rgba(218, 232, 223, 0.26);
    --dnb-text: #ebf0ec;
    --dnb-text-2: rgba(226, 235, 229, 0.75);
    --dnb-text-3: rgba(226, 235, 229, 0.48);
    --dnb-accent: #71ad94;
    --dnb-accent-soft: rgba(113, 173, 148, 0.16);
    --dnb-primary-bg: #58967c;
    --dnb-primary-bg-hover: #49836a;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #71ad94;
    --dnb-sage-soft: rgba(113, 173, 148, 0.14);
    --dnb-amber: #cea575;
    --dnb-amber-soft: rgba(206, 165, 117, 0.14);
    --dnb-coral: #d97a78;
    --dnb-coral-soft: rgba(217, 122, 120, 0.13);
    --dnb-switch-on: #66a389;
    --dnb-switch-off: rgba(218, 232, 223, 0.18);
    --dnb-radius-panel: 18px;
    --dnb-radius-card: 13px;
    --dnb-radius-pill: 10px;
    --dnb-font-display: inherit;
    --dnb-skin-shadow: 0 18px 42px rgba(5, 10, 8, 0.42);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="botanical"],
  html[data-ds-theme-source="light"][data-dnb-skin="botanical"],
  html[data-ds-theme-source="light"][data-dnb-skin="botanical"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="botanical"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="botanical"] .dnb-toast {
    --dnb-skin-bg: #dce4dd;
    --dnb-skin-ambient: none;
    --dnb-card: #f1f5f1;
    --dnb-card-hover: #e8efe9;
    --dnb-surface-sub: #e4ece6;
    --dnb-head-tint: rgba(45, 64, 52, 0.055);
    --dnb-fill: rgba(45, 64, 52, 0.085);
    --dnb-elevated: #f3f6f3;
    --dnb-popover: #f3f6f3;
    --dnb-border: rgba(45, 64, 52, 0.22);
    --dnb-border-strong: rgba(45, 64, 52, 0.34);
    --dnb-text: #1c2620;
    --dnb-text-2: #3f4f46;
    --dnb-text-3: #5f7066;
    --dnb-accent: #3d7a62;
    --dnb-accent-soft: rgba(61, 122, 98, 0.12);
    --dnb-primary-bg: #3d7a62;
    --dnb-primary-bg-hover: #316550;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #3d7a62;
    --dnb-sage-soft: rgba(61, 122, 98, 0.115);
    --dnb-amber: #976f3f;
    --dnb-amber-soft: rgba(151, 111, 63, 0.115);
    --dnb-coral: #b34f4d;
    --dnb-coral-soft: rgba(179, 79, 77, 0.105);
    --dnb-switch-on: #47876d;
    --dnb-switch-off: #bcc7be;
    --dnb-skin-shadow: 0 12px 32px rgba(28, 44, 34, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.48);
  }

  /* --- D. starlight: Hakimi Velvet Twilight & Champagne Stars --- */
  html[data-dnb-skin="starlight"],
  html[data-dnb-skin="starlight"] .dnb-menu,
  html[data-dnb-skin="starlight"] .dnb-modal-card,
  html[data-dnb-skin="starlight"] .dnb-toast,
  .dnb-panel[data-dnb-skin="starlight"] {
    --dnb-skin-bg: #131220;
    --dnb-skin-ambient: radial-gradient(circle at 18% 10%, rgba(233, 144, 171, 0.13), transparent 44%), radial-gradient(circle at 84% 86%, rgba(140, 158, 255, 0.11), transparent 46%);
    --dnb-card: #1f1d32;
    --dnb-card-hover: #282540;
    --dnb-surface-sub: #171527;
    --dnb-head-tint: rgba(220, 208, 255, 0.055);
    --dnb-fill: rgba(220, 208, 255, 0.09);
    --dnb-elevated: #292642;
    --dnb-popover: #221f38;
    --dnb-border: rgba(220, 208, 255, 0.17);
    --dnb-border-strong: rgba(232, 164, 188, 0.30);
    --dnb-text: #f8f5fc;
    --dnb-text-2: rgba(238, 232, 249, 0.76);
    --dnb-text-3: rgba(238, 232, 249, 0.50);
    --dnb-accent: #e990ab;
    --dnb-accent-soft: rgba(233, 144, 171, 0.17);
    --dnb-primary-bg: #d46f90;
    --dnb-primary-bg-hover: #c35e7f;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #86d2ba;
    --dnb-sage-soft: rgba(134, 210, 186, 0.14);
    --dnb-amber: #ebc273;
    --dnb-amber-soft: rgba(235, 194, 115, 0.15);
    --dnb-coral: #f18b98;
    --dnb-coral-soft: rgba(241, 139, 152, 0.13);
    --dnb-switch-on: #7cc5ad;
    --dnb-switch-off: rgba(220, 208, 255, 0.20);
    --dnb-radius-panel: 22px;
    --dnb-radius-card: 16px;
    --dnb-radius-pill: 999px;
    --dnb-font-display: inherit;
    --dnb-skin-shadow: 0 22px 48px rgba(10, 8, 24, 0.50);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="starlight"],
  html[data-ds-theme-source="light"][data-dnb-skin="starlight"],
  html[data-ds-theme-source="light"][data-dnb-skin="starlight"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="starlight"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="starlight"] .dnb-toast {
    --dnb-skin-bg: #e6dce6;
    --dnb-skin-ambient: radial-gradient(circle at 16% 12%, rgba(207, 99, 133, 0.08), transparent 44%), radial-gradient(circle at 85% 86%, rgba(114, 132, 232, 0.07), transparent 46%);
    --dnb-card: #f5eff5;
    --dnb-card-hover: #eee5ee;
    --dnb-surface-sub: #ebe1eb;
    --dnb-head-tint: rgba(118, 82, 110, 0.055);
    --dnb-fill: rgba(118, 82, 110, 0.085);
    --dnb-elevated: #f6f1f6;
    --dnb-popover: #f6f1f6;
    --dnb-border: rgba(118, 82, 110, 0.23);
    --dnb-border-strong: rgba(164, 96, 128, 0.36);
    --dnb-text: #251b29;
    --dnb-text-2: #524157;
    --dnb-text-3: #726078;
    --dnb-accent: #c15477;
    --dnb-accent-soft: rgba(193, 84, 119, 0.12);
    --dnb-primary-bg: #bd5073;
    --dnb-primary-bg-hover: #a64061;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #388870;
    --dnb-sage-soft: rgba(56, 136, 112, 0.11);
    --dnb-amber: #a87526;
    --dnb-amber-soft: rgba(168, 117, 38, 0.115);
    --dnb-coral: #be4f61;
    --dnb-coral-soft: rgba(190, 79, 97, 0.11);
    --dnb-switch-on: #44987f;
    --dnb-switch-off: #d2c4d0;
    --dnb-skin-shadow: 0 14px 36px rgba(88, 52, 76, 0.11), inset 0 1px 0 rgba(255, 255, 255, 0.45);
  }

  /* --- E. classic: Neutral Minimal Fallback --- */
  html[data-dnb-skin="classic"],
  html[data-dnb-skin="classic"] .dnb-menu,
  html[data-dnb-skin="classic"] .dnb-modal-card,
  html[data-dnb-skin="classic"] .dnb-toast,
  .dnb-panel[data-dnb-skin="classic"] {
    --dnb-skin-bg: #15161b;
    --dnb-skin-ambient: none;
    --dnb-card: #202229;
    --dnb-card-hover: #272a33;
    --dnb-surface-sub: #191b21;
    --dnb-head-tint: rgba(148, 163, 184, 0.06);
    --dnb-fill: rgba(148, 163, 184, 0.11);
    --dnb-elevated: #282b34;
    --dnb-popover: #23242a;
    --dnb-border: rgba(148, 163, 184, 0.20);
    --dnb-border-strong: rgba(148, 163, 184, 0.34);
    --dnb-text: #f3f4f6;
    --dnb-text-2: #cbd5e1;
    --dnb-text-3: #94a3b8;
    --dnb-accent: #60a5fa;
    --dnb-accent-soft: rgba(96, 165, 250, 0.15);
    --dnb-sage: #4ade80;
    --dnb-sage-soft: rgba(74, 222, 128, 0.13);
    --dnb-amber: #fbbf24;
    --dnb-amber-soft: rgba(251, 191, 36, 0.13);
    --dnb-coral: #f87171;
    --dnb-coral-soft: rgba(248, 113, 113, 0.13);
    --dnb-switch-on: #3b82f6;
    --dnb-switch-off: rgba(148, 163, 184, 0.25);
    --dnb-radius-panel: 18px;
    --dnb-radius-card: 12px;
    --dnb-radius-pill: 9px;
    --dnb-font-display: inherit;
    --dnb-skin-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="classic"],
  html[data-ds-theme-source="light"][data-dnb-skin="classic"],
  html[data-ds-theme-source="light"][data-dnb-skin="classic"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="classic"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="classic"] .dnb-toast {
    --dnb-skin-bg: #dfe5ee;
    --dnb-skin-ambient: none;
    --dnb-card: #f3f6fa;
    --dnb-card-hover: #eaf0f7;
    --dnb-surface-sub: #e6ecf4;
    --dnb-head-tint: rgba(15, 23, 42, 0.05);
    --dnb-fill: rgba(15, 23, 42, 0.082);
    --dnb-elevated: #f5f7fb;
    --dnb-popover: #f5f7fb;
    --dnb-border: #c5d0df;
    --dnb-border-strong: #a7b6cb;
    --dnb-text: #0f172a;
    --dnb-text-2: #334155;
    --dnb-text-3: #52627a;
    --dnb-accent: #1d4ed8;
    --dnb-accent-soft: rgba(29, 78, 216, 0.11);
    --dnb-sage: #15803d;
    --dnb-sage-soft: rgba(21, 128, 61, 0.11);
    --dnb-amber: #b45309;
    --dnb-amber-soft: rgba(180, 83, 9, 0.11);
    --dnb-coral: #b91c1c;
    --dnb-coral-soft: rgba(185, 28, 28, 0.10);
    --dnb-switch-on: #2563eb;
    --dnb-switch-off: #bcc7d8;
    --dnb-skin-shadow: 0 14px 36px rgba(15, 23, 42, 0.14);
  }

  /* --- F. custom: Dynamic User / Image / Chief DIY Skin Base Fallback --- */
  html[data-dnb-skin="custom"],
  html[data-dnb-skin="custom"] .dnb-menu,
  html[data-dnb-skin="custom"] .dnb-modal-card,
  html[data-dnb-skin="custom"] .dnb-toast,
  .dnb-panel[data-dnb-skin="custom"] {
    --dnb-skin-bg: #161826;
    --dnb-skin-ambient: radial-gradient(circle at 14% 10%, rgba(139, 124, 246, 0.16), transparent 44%), radial-gradient(circle at 86% 18%, rgba(92, 201, 167, 0.12), transparent 44%);
    --dnb-card: #212438;
    --dnb-card-hover: #292c43;
    --dnb-surface-sub: #1b1d2e;
    --dnb-head-tint: rgba(235, 238, 252, 0.048);
    --dnb-fill: rgba(235, 238, 252, 0.085);
    --dnb-elevated: #2a2d45;
    --dnb-popover: #22253a;
    --dnb-border: rgba(235, 238, 252, 0.16);
    --dnb-border-strong: rgba(235, 238, 252, 0.28);
    --dnb-text: #f3f4fa;
    --dnb-text-2: rgba(236, 238, 250, 0.76);
    --dnb-text-3: rgba(236, 238, 250, 0.50);
    --dnb-accent: #9d90f8;
    --dnb-accent-soft: rgba(157, 144, 248, 0.165);
    --dnb-primary-bg: #7968ee;
    --dnb-primary-bg-hover: #6756df;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #5cc9a7;
    --dnb-sage-soft: rgba(92, 201, 167, 0.14);
    --dnb-amber: #f0b868;
    --dnb-amber-soft: rgba(240, 184, 104, 0.14);
    --dnb-coral: #ef8787;
    --dnb-coral-soft: rgba(239, 135, 135, 0.13);
    --dnb-switch-on: #5cc9a7;
    --dnb-switch-off: rgba(235, 238, 248, 0.19);
    --dnb-radius-panel: 22px;
    --dnb-radius-card: 15px;
    --dnb-radius-pill: 999px;
    --dnb-font-display: inherit;
    --dnb-skin-shadow: 0 20px 48px rgba(6, 8, 18, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin="custom"],
  html[data-ds-theme-source="light"][data-dnb-skin="custom"],
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-menu,
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-modal-card,
  html[data-ds-theme-source="light"][data-dnb-skin="custom"] .dnb-toast {
    --dnb-skin-bg: #dfe3ef;
    --dnb-skin-ambient: radial-gradient(circle at 14% 10%, rgba(108, 92, 231, 0.08), transparent 45%), radial-gradient(circle at 86% 18%, rgba(45, 155, 123, 0.07), transparent 45%);
    --dnb-card: #f2f4fa;
    --dnb-card-hover: #eaeef7;
    --dnb-surface-sub: #e7ebf5;
    --dnb-head-tint: rgba(58, 66, 98, 0.055);
    --dnb-fill: rgba(58, 66, 98, 0.085);
    --dnb-elevated: #f5f6fb;
    --dnb-popover: #f5f6fb;
    --dnb-border: rgba(58, 66, 98, 0.22);
    --dnb-border-strong: rgba(58, 66, 98, 0.34);
    --dnb-text: #161b2e;
    --dnb-text-2: #3d4661;
    --dnb-text-3: #5d6782;
    --dnb-accent: #5e4bd8;
    --dnb-accent-soft: rgba(94, 75, 216, 0.12);
    --dnb-primary-bg: #5e4bd8;
    --dnb-primary-bg-hover: #4d3bc4;
    --dnb-primary-fg: #ffffff;
    --dnb-sage: #268468;
    --dnb-sage-soft: rgba(38, 132, 104, 0.115);
    --dnb-amber: #a86f21;
    --dnb-amber-soft: rgba(168, 111, 33, 0.115);
    --dnb-coral: #be4d4d;
    --dnb-coral-soft: rgba(190, 77, 77, 0.105);
    --dnb-switch-on: #268468;
    --dnb-switch-off: #bfc6da;
    --dnb-skin-shadow: 0 14px 36px rgba(32, 42, 68, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  /* ========================================================================
   * 2. Whole-Plugin Refinement Overrides ("Wash Away Hard Boxes & Neon")
   * ======================================================================== */

  .dnb-panel[data-dnb-skin] {
    background-color: var(--dnb-skin-bg);
    background-image: var(--dnb-skin-ambient, none);
    border-radius: var(--dnb-radius-panel);
    box-shadow: var(--dnb-skin-shadow);
    border-color: var(--dnb-border-strong);
    transition: background-color 0.24s ease, border-color 0.24s ease, border-radius 0.24s ease, box-shadow 0.24s ease;
  }
  .dnb-panel[data-dnb-skin] > .dnb-head {
    position: relative;
    z-index: 80;
  }
  .dnb-panel[data-dnb-skin] > .dnb-sec-bar {
    position: relative;
    z-index: 70;
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin]:not(.dnb-main) {
    background-color: var(--dnb-skin-bg);
    background-image: var(--dnb-skin-ambient, none);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel.dnb-main[data-dnb-skin] {
    border-radius: 0;
    box-shadow: none;
  }

  /* Soften Headers, Prevent Narrow-Sidebar Cramping & Enforce Crisp Wrapping */
  .dnb-panel[data-dnb-skin] .dnb-head {
    border-bottom: 1px solid var(--dnb-border);
    flex-wrap: wrap;
    row-gap: 6px;
    column-gap: 5px;
    padding: 8px 10px 7px;
  }
  .dnb-panel[data-dnb-skin] .dnb-title {
    font-family: var(--dnb-font-display);
    font-weight: 500;
    letter-spacing: -0.01em;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-run-mode-pill,
  .dnb-panel[data-dnb-skin] .dnb-run-mode-btn {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-head-pill {
    min-width: 0;
    max-width: 175px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @container dnb-head (max-width: 660px) {
    .dnb-panel[data-dnb-skin] .dnb-head-actions {
      flex: 1 1 100%;
      flex-wrap: wrap;
      row-gap: 4px;
      margin-left: 0;
      padding-top: 2px;
      justify-content: flex-end;
      min-width: 0;
    }
    .dnb-panel[data-dnb-skin] .dnb-head-actions > .dnb-head-pill {
      margin-right: auto;
      max-width: 162px;
    }
    .dnb-panel[data-dnb-skin] .dnb-head-actions > .dnb-model-pill {
      flex: 0 1 auto;
      min-width: 82px;
      max-width: 172px;
    }
  }
  @container dnb-head (max-width: 460px) {
    .dnb-panel[data-dnb-skin] .dnb-skin-pop {
      left: -64px;
      width: min(244px, calc(100vw - 24px));
    }
  }

  /* Unified Crisp Navigation Slot (Distinct Boundaries Without 5-Color Rainbow Noise) */
  .dnb-panel[data-dnb-skin] .dnb-seg {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    border-radius: 11px;
    padding: 3px;
    gap: 3px;
  }
  .dnb-panel[data-dnb-skin] .dnb-seg-btn {
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    padding: 5px 6px;
    color: var(--dnb-text-2);
    font-weight: 450;
  }
  .dnb-panel[data-dnb-skin] .dnb-seg-btn:hover {
    color: var(--dnb-text);
    background: var(--dnb-fill);
  }
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"],
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="chief"],
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="tasks"],
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="peers"],
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="archive"],
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="boundaries"] {
    --dnb-tab-bar: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    font-weight: 600;
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"]::after {
    display: none;
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn {
    color: var(--dnb-text-2);
    background: transparent;
    border-color: transparent;
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn:hover {
    color: var(--dnb-text);
    background: var(--dnb-fill);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="chief"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="tasks"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="peers"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="archive"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-seg-btn[data-active="1"][data-tab="boundaries"] {
    --dnb-tab-bar: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    font-weight: 600;
    box-shadow: none;
  }

  /* Crisp L1 Accordion Card Boundaries + Distinct Header Band */
  .dnb-panel[data-dnb-skin] .dnb-acc-card,
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="cyan"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="blue"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="indigo"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="emerald"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="violet"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="amber"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="rose"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="slate"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-wall-box,
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-obj-card,
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-board-card,
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-handoff-card {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    border-radius: var(--dnb-radius-card);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="rose"],
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-wall-box { border-left: 2.5px solid var(--dnb-coral); }

  .dnb-panel[data-dnb-skin] .dnb-acc-card > .dnb-acc-head {
    background: var(--dnb-head-tint);
    border-radius: calc(var(--dnb-radius-card, 14px) - 1px);
    padding: 8px 12px;
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card[data-open="1"] > .dnb-acc-head {
    border-radius: calc(var(--dnb-radius-card, 14px) - 1px) calc(var(--dnb-radius-card, 14px) - 1px) 0 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card > .dnb-acc-head:hover {
    background: var(--dnb-fill);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card > .dnb-acc-body {
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-title {
    font-weight: 550;
    letter-spacing: -0.005em;
  }

  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card,
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="cyan"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="blue"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="indigo"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="emerald"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="violet"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="amber"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="rose"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="slate"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-wall-box {
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card[data-tone="rose"],
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-wall-box { border-left-color: var(--dnb-coral); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card > .dnb-acc-head {
    background: var(--dnb-head-tint);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card > .dnb-acc-body {
    border-top-color: var(--dnb-border);
  }

  /* Soften Safety Banner on Boundaries Page */
  .dnb-safety-banner {
    margin-bottom: 10px;
    padding: 9px 12px;
    border-radius: var(--dnb-radius-card);
    border: 1px solid var(--dnb-border-strong);
    border-left: 2.5px solid var(--dnb-sage);
    background: var(--dnb-card);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    transition: background 0.18s ease, border-color 0.18s ease;
  }
  .dnb-safety-banner[data-off="1"] {
    border-left-color: var(--dnb-coral);
    background: var(--dnb-coral-soft);
  }
  .dnb-safety-banner-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--dnb-sage);
  }
  .dnb-safety-banner[data-off="1"] .dnb-safety-banner-title {
    color: var(--dnb-coral);
  }
  .dnb-safety-banner-sub {
    font-size: 11px;
    color: var(--dnb-text-3);
    margin-top: 2px;
    line-height: 1.45;
  }

  /* Unified Soft Radii & Surfaces on Pills, Switches, Popovers, Inputs, Presets */
  .dnb-panel[data-dnb-skin] .dnb-pill,
  .dnb-panel[data-dnb-skin] .dnb-head-pill,
  .dnb-panel[data-dnb-skin] .dnb-mini-btn,
  .dnb-panel[data-dnb-skin] .dnb-primary-btn,
  .dnb-panel[data-dnb-skin] .dnb-run-mode-pill,
  .dnb-panel[data-dnb-skin] .dnb-wall-scope-btn {
    border-radius: var(--dnb-radius-pill);
  }
  .dnb-panel[data-dnb-skin] .dnb-group,
  .dnb-panel[data-dnb-skin] .dnb-wall-item,
  .dnb-panel[data-dnb-skin] .dnb-preset-card,
  .dnb-panel[data-dnb-skin] .dnb-prose-card,
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box {
    border-radius: var(--dnb-radius-card);
    border-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-preset-card[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-switch {
    background: var(--dnb-switch-off);
  }
  .dnb-panel[data-dnb-skin] .dnb-switch[data-on="1"] {
    background: var(--dnb-switch-on);
  }
  .dnb-panel[data-dnb-skin] .dnb-switch[data-on="1"][data-tone="red"] {
    background: var(--dnb-coral);
  }
  .dnb-panel[data-dnb-skin] .dnb-tactical-pop {
    background: var(--dnb-popover);
    border: 1px solid var(--dnb-border-strong);
    border-radius: var(--dnb-radius-card);
    box-shadow: var(--dnb-skin-shadow);
    backdrop-filter: blur(22px) saturate(1.15);
  }
  .dnb-panel[data-dnb-skin] .dnb-tactical-head {
    background: transparent;
    border-bottom: 1px solid var(--dnb-border);
    padding: 9px 12px;
  }
  .dnb-panel[data-dnb-skin] .dnb-tactical-row {
    border-radius: 10px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-tactical-row:hover {
    background: var(--dnb-fill);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tactical-pop {
    background: var(--dnb-popover);
    border-color: var(--dnb-border-strong);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tactical-head {
    background: transparent;
    border-bottom-color: var(--dnb-border);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tactical-row {
    border-bottom-color: var(--dnb-border);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tactical-row:hover {
    background: var(--dnb-fill);
  }

  /* Star & Private Brain Harmony */
  .dnb-panel[data-dnb-skin] .dnb-star-btn {
    border-radius: var(--dnb-radius-pill);
    background: var(--dnb-card);
    border-color: var(--dnb-border);
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-star-btn:hover {
    background: var(--dnb-amber-soft);
    border-color: var(--dnb-amber);
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-star-btn[data-starred="1"] {
    background: var(--dnb-amber-soft);
    border-color: var(--dnb-amber);
    color: var(--dnb-amber);
    box-shadow: none;
  }

  /* ========================================================================
   * 3. Skin-Harmonized Interactive Fan Effort Dial (.dnb-fan-gauge)
   * ======================================================================== */

  .dnb-panel[data-dnb-skin] .dnb-fan-gauge {
    width: 100%;
    padding: 2px 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-fan-hub {
    background-color: var(--dnb-card);
    background-image: none;
    border: 1px solid var(--dnb-border-strong);
    color: var(--dnb-text);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel[data-dnb-skin] .dnb-fan-hub:hover {
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-fan-hub[data-active="1"] {
    background-color: var(--dnb-accent-soft);
    background-image: none;
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    box-shadow: none;
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-fan-hub {
    background-color: var(--dnb-card);
    background-image: none;
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-fan-hub[data-active="1"] {
    background-color: var(--dnb-accent-soft);
    background-image: none;
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }

  /* ========================================================================
   * 4. Top-Bar Quick Theme Popover & Settings Theme Card Grid
   * ======================================================================== */

  .dnb-skin-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 248px;
    z-index: 140;
    padding: 6px;
    background: var(--dnb-popover, #1b1e31);
    opacity: 1;
    border: 1px solid var(--dnb-border-strong);
    border-radius: var(--dnb-radius-card, 14px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.56);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  html[data-ds-theme-source="light"] .dnb-skin-pop {
    background: var(--dnb-popover, #ffffff);
    box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  }
  .dnb-skin-pop-title {
    padding: 4px 8px 3px;
    font-size: 11px;
    font-weight: 500;
    color: var(--dnb-text-3);
  }
  .dnb-skin-pop-item {
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text);
    border-radius: var(--dnb-radius-pill, 9px);
    padding: 7px 9px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .dnb-skin-pop-item:hover {
    background: var(--dnb-fill);
  }
  .dnb-skin-pop-item[data-active="1"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-border-strong);
  }
  .dnb-skin-swatches {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .dnb-skin-swatch-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid rgba(128, 128, 140, 0.25);
  }

  .dnb-skin-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  @media (max-width: 340px) {
    .dnb-skin-grid { grid-template-columns: 1fr; }
  }
  .dnb-skin-card {
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    border-radius: var(--dnb-radius-card, 12px);
    padding: 9px 10px;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--dnb-text);
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
  }
  .dnb-skin-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-skin-card:active {
    transform: scale(0.985);
  }
  .dnb-skin-card[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-skin-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .dnb-skin-card-name {
    font-size: 12px;
    font-weight: 500;
  }
  .dnb-skin-card-tag {
    font-size: 10.5px;
    color: var(--dnb-accent);
  }
  .dnb-skin-card-desc {
    font-size: 11px;
    line-height: 1.4;
    color: var(--dnb-text-3);
  }

  /* ========================================================================
   * 5. Route C: Apple Bento Objective & Circular Ring Hero Card
   * ======================================================================== */

  .dnb-bento-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(215px, 0.95fr);
    gap: 10px;
    padding: 12px;
    margin-bottom: 10px;
    border-radius: var(--dnb-radius-card, 14px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  .dnb-bento-hero[data-locked="1"] {
    border-color: var(--dnb-amber);
    box-shadow: 0 0 0 1px var(--dnb-amber-soft);
  }
  .dnb-bento-hero[data-collapsed="1"] {
    grid-template-columns: 1fr;
    padding: 9px 12px;
  }
  @media (max-width: 520px) {
    .dnb-bento-hero {
      grid-template-columns: 1fr;
      gap: 9px;
    }
  }
  .dnb-panel.dnb-dock .dnb-bento-hero {
    grid-template-columns: 1fr;
    gap: 9px;
  }
  @container (max-width: 540px) {
    .dnb-bento-hero {
      grid-template-columns: 1fr;
      gap: 9px;
    }
  }
  .dnb-bento-goal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .dnb-bento-goal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dnb-bento-head-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .dnb-bento-title {
    font-family: var(--dnb-font-display);
    font-size: 13px;
    font-weight: 600;
    color: var(--dnb-text);
    letter-spacing: -0.01em;
  }
  .dnb-bento-head-ops {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .dnb-bento-goal-text {
    font-size: 12.8px;
    font-weight: 450;
    line-height: 1.56;
    color: var(--dnb-text);
    padding: 7px 10px;
    border-radius: calc(var(--dnb-radius-card, 12px) - 3px);
    background: var(--dnb-fill);
    border: 1px solid transparent;
    cursor: text;
    word-break: break-word;
    transition: border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-bento-goal-text:hover {
    border-color: var(--dnb-border);
    background: var(--dnb-card-hover);
  }
  .dnb-bento-textarea {
    border-radius: calc(var(--dnb-radius-card, 12px) - 3px);
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border-strong);
    padding: 8px 10px;
    font-size: 12.5px;
    line-height: 1.55;
  }
  .dnb-bento-goal-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--dnb-border);
    margin-top: auto;
  }
  .dnb-bento-collapsed-preview {
    font-size: 12px;
    color: var(--dnb-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dnb-bento-ring-tile {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 9px;
    padding: 10px 11px;
    border-radius: calc(var(--dnb-radius-card, 14px) - 2px);
    background: var(--dnb-surface-sub, var(--dnb-fill));
    border: 1px solid var(--dnb-border-strong);
    min-width: 0;
  }
  .dnb-bento-ring-top {
    display: flex;
    align-items: center;
    gap: 11px;
    min-width: 0;
  }
  .dnb-bento-ring-wrap {
    position: relative;
    width: 62px;
    height: 62px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dnb-bento-ring {
    display: block;
  }
  .dnb-bento-ring-val {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    pointer-events: none;
  }
  .dnb-bento-ring-num {
    font-size: 14.5px;
    font-weight: 600;
    line-height: 1;
    color: var(--dnb-text);
    font-variant-numeric: tabular-nums;
  }
  .dnb-bento-ring-pct {
    font-size: 9.5px;
    color: var(--dnb-text-3);
  }
  .dnb-bento-stats {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .dnb-bento-stat-main {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--dnb-text);
  }
  .dnb-bento-stat-sub {
    font-size: 10.8px;
    color: var(--dnb-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dnb-bento-focus-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    margin-top: 2px;
    padding: 3px 8px;
    border-radius: var(--dnb-radius-pill, 999px);
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    color: var(--dnb-accent);
    font: inherit;
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .dnb-bento-focus-pill:hover {
    background: var(--dnb-card-hover);
    border-color: var(--dnb-accent);
  }
  .dnb-bento-focus-pill[data-done="1"] {
    cursor: default;
    color: var(--dnb-sage);
    border-color: var(--dnb-sage-soft);
    background: var(--dnb-sage-soft);
  }
  .dnb-bento-focus-dot {
    width: 5.5px;
    height: 5.5px;
    border-radius: 50%;
    background: var(--dnb-accent);
    flex-shrink: 0;
    animation: dnb-beam-pulse-dot 1.8s ease-in-out infinite;
  }
  .dnb-bento-focus-txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-bento-ring-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-top: 7px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-bento-foot-hint {
    font-size: 10.5px;
    color: var(--dnb-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ========================================================================
   * 6. Route B: Classic Dot-Matrix Interactive SVG Flow Canvas (5-Skin Adaptive)
   * ======================================================================== */

  @keyframes dnb-beam-flow {
    from { stroke-dashoffset: 24; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes dnb-beam-sub-flow {
    from { stroke-dashoffset: 16; }
    to { stroke-dashoffset: 0; }
  }
  @keyframes dnb-beam-pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.84); }
  }

  .dnb-panel[data-dnb-skin] .dnb-acc-mini-mile {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-mini-mile[data-status="done"] {
    background: var(--dnb-sage);
    border-color: var(--dnb-sage);
    color: #ffffff;
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-mini-mile[data-status="doing"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    box-shadow: 0 0 0 2px var(--dnb-accent-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-mini-mile[data-status="blocked"] {
    background: var(--dnb-coral-soft);
    border-color: var(--dnb-coral);
    color: var(--dnb-coral);
    box-shadow: 0 0 0 2px var(--dnb-coral-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-mini-link {
    background: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-mini-link[data-done="1"] {
    background: var(--dnb-sage);
  }

  .dnb-beam-pipeline {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-zoom-group {
    background: var(--dnb-surface-sub, var(--dnb-fill));
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-zoom-btn[data-active="1"] {
    background: var(--dnb-card);
    color: var(--dnb-text);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-canvas {
    border-radius: var(--dnb-radius-card, 13px);
    border: 1px solid var(--dnb-border-strong);
    background-color: color-mix(in srgb, var(--dnb-skin-bg) 86%, #000000);
    background-image: radial-gradient(color-mix(in srgb, var(--dnb-text-3) 34%, transparent) 1px, transparent 1px);
    background-size: 18px 18px;
  }

  /* SVG Curves & Directional Arrows */
  .dnb-beam-edge {
    fill: none;
    stroke: var(--dnb-border-strong);
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-dasharray: 5 4;
    opacity: 0.78;
  }
  .dnb-beam-edge[data-status="done"] {
    stroke: var(--dnb-sage);
    stroke-width: 2.2;
    stroke-dasharray: none;
    opacity: 0.85;
  }
  .dnb-beam-edge[data-status="doing"] {
    stroke: var(--dnb-accent);
    stroke-width: 1.9;
    opacity: 0.85;
  }
  .dnb-beam-edge[data-status="blocked"] {
    stroke: var(--dnb-coral);
    stroke-width: 1.9;
    opacity: 0.85;
  }
  .dnb-beam-arrow-path[data-status="done"] { fill: var(--dnb-sage); }
  .dnb-beam-arrow-path[data-status="doing"] { fill: var(--dnb-accent); }
  .dnb-beam-arrow-path[data-status="blocked"] { fill: var(--dnb-coral); }
  .dnb-beam-arrow-path[data-status="todo"] { fill: var(--dnb-border-strong); }
  .dnb-beam-pulse {
    fill: none;
    stroke: var(--dnb-accent);
    stroke-width: 2.3;
    stroke-linecap: round;
    stroke-dasharray: 6 18;
    animation: dnb-beam-flow 1.6s linear infinite;
    opacity: 0.92;
  }
  .dnb-beam-pulse[data-status="done"] {
    stroke: var(--dnb-sage);
    opacity: 0.78;
  }
  .dnb-beam-pulse[data-status="blocked"] {
    stroke: var(--dnb-coral);
    opacity: 0.85;
  }
  .dnb-beam-dispatch {
    fill: none;
    stroke: var(--dnb-accent);
    stroke-opacity: 0.58;
    stroke-width: 1.45;
    stroke-linecap: round;
    stroke-dasharray: 4 3.5;
  }
  .dnb-beam-dispatch[data-status="done"] {
    stroke: var(--dnb-sage);
    stroke-opacity: 0.62;
  }
  .dnb-beam-dispatch[data-status="blocked"] {
    stroke: var(--dnb-coral);
    stroke-opacity: 0.66;
  }
  .dnb-beam-return {
    fill: none;
    stroke: var(--dnb-border-strong);
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-dasharray: 4 3.5;
  }
  .dnb-beam-return[data-status="done"] {
    stroke: var(--dnb-sage);
    stroke-width: 2.15;
    stroke-dasharray: none;
    opacity: 0.88;
  }
  .dnb-beam-return[data-status="doing"] {
    stroke: var(--dnb-accent);
    stroke-width: 1.85;
    opacity: 0.86;
  }
  .dnb-beam-return[data-status="blocked"] {
    stroke: var(--dnb-coral);
    stroke-width: 1.85;
    opacity: 0.86;
  }
  .dnb-beam-sub-pulse {
    fill: none;
    stroke: var(--dnb-accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 5 11;
    animation: dnb-beam-sub-flow 1.25s linear infinite;
    opacity: 0.9;
  }
  .dnb-beam-sub-pulse[data-status="done"] {
    stroke: var(--dnb-sage);
    opacity: 0.8;
  }
  .dnb-beam-sub-pulse[data-status="blocked"] {
    stroke: var(--dnb-coral);
    opacity: 0.85;
  }

  /* Classic SVG Step Cards & Subagent Lane Cards */
  .dnb-beam-node-rect {
    fill: var(--dnb-card);
    stroke: var(--dnb-border-strong);
    stroke-width: 1.45;
    transition: stroke-width 0.14s ease, filter 0.16s ease, fill 0.16s ease;
  }
  .dnb-beam-node[data-status="done"] .dnb-beam-node-rect {
    fill: color-mix(in srgb, var(--dnb-sage) 15%, var(--dnb-skin-bg));
    stroke: var(--dnb-sage);
  }
  .dnb-beam-node[data-status="doing"] .dnb-beam-node-rect {
    fill: color-mix(in srgb, var(--dnb-accent) 16%, var(--dnb-skin-bg));
    stroke: var(--dnb-accent);
  }
  .dnb-beam-node[data-status="blocked"] .dnb-beam-node-rect {
    fill: color-mix(in srgb, var(--dnb-coral) 16%, var(--dnb-skin-bg));
    stroke: var(--dnb-coral);
  }
  .dnb-beam-node:hover .dnb-beam-node-rect,
  .dnb-beam-node[data-selected="1"] .dnb-beam-node-rect {
    stroke-width: 2.2;
  }
  .dnb-beam-node[data-selected="1"][data-status="doing"] .dnb-beam-node-rect {
    filter: drop-shadow(0 0 8px var(--dnb-accent-soft));
  }
  .dnb-beam-node[data-selected="1"][data-status="done"] .dnb-beam-node-rect {
    filter: drop-shadow(0 0 8px var(--dnb-sage-soft));
  }
  .dnb-beam-node[data-selected="1"][data-status="blocked"] .dnb-beam-node-rect {
    filter: drop-shadow(0 0 8px var(--dnb-coral-soft));
  }

  .dnb-beam-node-bar { fill: var(--dnb-border-strong); }
  .dnb-beam-node[data-status="done"] .dnb-beam-node-bar { fill: var(--dnb-sage); }
  .dnb-beam-node[data-status="doing"] .dnb-beam-node-bar { fill: var(--dnb-accent); }
  .dnb-beam-node[data-status="blocked"] .dnb-beam-node-bar { fill: var(--dnb-coral); }

  .dnb-beam-idx-circle {
    fill: var(--dnb-fill);
    stroke: var(--dnb-border-strong);
    stroke-width: 1.25;
  }
  .dnb-beam-node[data-status="done"] .dnb-beam-idx-circle {
    fill: var(--dnb-sage);
    stroke: var(--dnb-sage);
  }
  .dnb-beam-node[data-status="doing"] .dnb-beam-idx-circle {
    fill: var(--dnb-accent-soft);
    stroke: var(--dnb-accent);
  }
  .dnb-beam-node[data-status="blocked"] .dnb-beam-idx-circle {
    fill: var(--dnb-coral-soft);
    stroke: var(--dnb-coral);
  }
  .dnb-beam-idx-text { fill: var(--dnb-text-2); }
  .dnb-beam-node[data-status="done"] .dnb-beam-idx-text { fill: #ffffff; }
  .dnb-beam-node[data-status="doing"] .dnb-beam-idx-text { fill: var(--dnb-accent); }
  .dnb-beam-node[data-status="blocked"] .dnb-beam-idx-text { fill: var(--dnb-coral); }

  .dnb-beam-svg-title { fill: var(--dnb-text); }
  .dnb-beam-svg-meta { fill: var(--dnb-text-3); }
  .dnb-beam-node[data-status="done"] .dnb-beam-svg-meta { fill: var(--dnb-sage); }
  .dnb-beam-node[data-status="doing"] .dnb-beam-svg-meta { fill: var(--dnb-accent); }
  .dnb-beam-node[data-status="blocked"] .dnb-beam-svg-meta { fill: var(--dnb-coral); }

  .dnb-beam-agent-rect {
    fill: var(--dnb-card);
    stroke: var(--dnb-border-strong);
    stroke-width: 1.35;
    transition: stroke-width 0.14s ease, filter 0.16s ease, fill 0.16s ease;
  }
  .dnb-beam-agent-node[data-status="done"] .dnb-beam-agent-rect {
    fill: color-mix(in srgb, var(--dnb-sage) 13%, var(--dnb-skin-bg));
    stroke: color-mix(in srgb, var(--dnb-sage) 82%, transparent);
  }
  .dnb-beam-agent-node[data-status="doing"] .dnb-beam-agent-rect {
    fill: color-mix(in srgb, var(--dnb-accent) 14%, var(--dnb-skin-bg));
    stroke: color-mix(in srgb, var(--dnb-accent) 85%, transparent);
  }
  .dnb-beam-agent-node[data-status="blocked"] .dnb-beam-agent-rect {
    fill: color-mix(in srgb, var(--dnb-coral) 14%, var(--dnb-skin-bg));
    stroke: color-mix(in srgb, var(--dnb-coral) 85%, transparent);
  }
  .dnb-beam-agent-node:hover .dnb-beam-agent-rect,
  .dnb-beam-agent-node[data-focused="1"] .dnb-beam-agent-rect {
    stroke-width: 2.1;
  }
  .dnb-beam-agent-dot-svg { fill: var(--dnb-border-strong); }
  .dnb-beam-agent-node[data-status="done"] .dnb-beam-agent-dot-svg { fill: var(--dnb-sage); }
  .dnb-beam-agent-node[data-status="doing"] .dnb-beam-agent-dot-svg { fill: var(--dnb-accent); }
  .dnb-beam-agent-node[data-status="blocked"] .dnb-beam-agent-dot-svg { fill: var(--dnb-coral); }
  .dnb-beam-agent-svg-name { fill: var(--dnb-text); }
  .dnb-beam-agent-svg-meta { fill: var(--dnb-text-3); }
  .dnb-beam-agent-node[data-status="done"] .dnb-beam-agent-svg-meta { fill: var(--dnb-sage); }
  .dnb-beam-agent-node[data-status="doing"] .dnb-beam-agent-svg-meta { fill: var(--dnb-accent); }
  .dnb-beam-agent-node[data-status="blocked"] .dnb-beam-agent-svg-meta { fill: var(--dnb-coral); }

  /* Keep HTML button .dnb-beam-idx for inline drawer header */
  .dnb-beam-idx {
    width: 21px;
    height: 21px;
    border-radius: 50%;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    font-size: 10.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
    cursor: pointer;
    transition: transform 0.12s ease, background 0.15s ease, border-color 0.15s ease;
  }
  .dnb-beam-idx:hover:not(:disabled) { transform: scale(1.08); }
  .dnb-beam-idx:disabled { cursor: default; opacity: 0.85; }
  .dnb-beam-idx[data-status="done"] {
    background: var(--dnb-sage);
    border-color: var(--dnb-sage);
    color: #0e1a15;
  }
  .dnb-beam-idx[data-status="doing"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  .dnb-beam-idx[data-status="blocked"] {
    background: var(--dnb-coral-soft);
    border-color: var(--dnb-coral);
    color: var(--dnb-coral);
  }

  .dnb-beam-drawer {
    border-radius: var(--dnb-radius-card, 14px);
    border: 1px solid var(--dnb-border-strong);
    border-left: 2.5px solid var(--dnb-accent);
    background: var(--dnb-elevated);
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: dnb-enter 0.16s ease-out;
  }
  .dnb-beam-drawer[data-status="done"] { border-left-color: var(--dnb-sage); }
  .dnb-beam-drawer[data-status="blocked"] { border-left-color: var(--dnb-coral); }
  .dnb-beam-drawer-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .dnb-beam-drawer-title {
    font-size: 13px;
    font-weight: 550;
    line-height: 1.45;
    color: var(--dnb-text);
    word-break: break-word;
  }

  /* ========================================================================
   * 7. Whole-Frontend 5-Skin Polish (Header, Tasks List, Chief, Peers, Archives)
   * ======================================================================== */

  /* Live Cursor Bar & Header Run-Mode Pill Harmony (Crisp Bounded Status Strip) */
  .dnb-live-cursor-bar {
    padding: 6px 11px;
    border-radius: 10px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 480;
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .dnb-live-cursor-bar:hover {
    background: var(--dnb-card-hover);
    border-color: var(--dnb-accent);
    color: var(--dnb-text);
  }
  .dnb-live-cursor-bar[data-blocked="1"] {
    padding: 6px 11px;
    border-radius: 10px;
    background: var(--dnb-coral-soft);
    border-color: var(--dnb-coral);
    color: var(--dnb-coral);
    font-weight: 550;
  }

  .dnb-panel[data-dnb-skin] .dnb-run-mode-pill {
    background: var(--dnb-fill);
    border-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-run-mode-btn[data-active="1"][data-rm="managed"] {
    background: var(--dnb-sage-soft);
    border-color: var(--dnb-sage);
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-run-mode-btn[data-active="1"][data-rm="patrol"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-run-mode-btn[data-active="1"][data-rm="off"] {
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }

  /* Wash Away Harsh Neon Hexes in Task List & Milestone Bar */
  .dnb-panel[data-dnb-skin] .dnb-flow-stage {
    border-radius: var(--dnb-radius-card, 13px);
    border-width: 1px;
    border-left-width: 2.5px;
    border-color: var(--dnb-border);
    border-left-color: var(--dnb-border-strong);
    background: var(--dnb-card);
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="done"] {
    border-color: var(--dnb-border);
    border-left-color: var(--dnb-sage);
    background: linear-gradient(90deg, var(--dnb-sage-soft) 0%, var(--dnb-card) 52%);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="doing"] {
    border-color: var(--dnb-border-strong);
    border-left-color: var(--dnb-accent);
    background: linear-gradient(90deg, var(--dnb-accent-soft) 0%, var(--dnb-card) 58%);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="blocked"] {
    border-color: var(--dnb-border);
    border-left-color: var(--dnb-coral);
    background: linear-gradient(90deg, var(--dnb-coral-soft) 0%, var(--dnb-card) 58%);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-step-num[data-status="done"] {
    background: var(--dnb-sage);
    border-color: var(--dnb-sage);
    color: #0e1a15;
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-step-num[data-status="doing"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-step-num[data-status="blocked"] {
    background: var(--dnb-coral-soft);
    border-color: var(--dnb-coral);
    color: var(--dnb-coral);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-status-pill[data-status="done"] {
    background: var(--dnb-sage-soft);
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-status-pill[data-status="doing"] {
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-status-pill[data-status="blocked"] {
    background: var(--dnb-coral-soft);
    color: var(--dnb-coral);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-connector {
    color: var(--dnb-border-strong);
    padding: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-connector[data-done="1"] {
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-connector[data-doing="1"] {
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-stage-summary,
  .dnb-panel[data-dnb-skin] .dnb-flow-task-ev {
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-count-chip[data-kind="agents"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-agent-card[data-status="done"],
  .dnb-panel[data-dnb-skin] .dnb-flow-return-badge[data-status="done"] {
    border-color: var(--dnb-sage);
    background: var(--dnb-sage-soft);
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-agent-card[data-status="doing"],
  .dnb-panel[data-dnb-skin] .dnb-flow-return-badge[data-status="doing"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-flow-agent-card[data-status="blocked"],
  .dnb-panel[data-dnb-skin] .dnb-flow-return-badge[data-status="blocked"] {
    border-color: var(--dnb-coral);
    background: var(--dnb-coral-soft);
    color: var(--dnb-coral);
  }
  .dnb-panel[data-dnb-skin] .dnb-text-filter-btn {
    border-radius: var(--dnb-radius-pill, 999px);
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    color: var(--dnb-text-2);
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-text-filter-btn:hover {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-text-filter-btn[data-active="1"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    font-weight: 600;
  }

  /* Chief Overview: Plan A Editorial Calm Layout, Ghost Actions & Thread Stream */
  .dnb-panel[data-dnb-skin] .dnb-ghost-btn {
    height: 24px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11.5px;
    font-weight: 450;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.14s ease, color 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-ghost-btn:hover:not(:disabled) {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-ghost-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .dnb-panel[data-dnb-skin] .dnb-ghost-btn[data-active="1"] {
    background: var(--dnb-fill);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-goal {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-goal-kicker {
    font-size: 11px;
    color: var(--dnb-text-3);
    margin-bottom: 3px;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-goal-text {
    font-size: 13.5px;
    font-weight: 550;
    line-height: 1.55;
    color: var(--dnb-text);
    word-break: break-word;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert {
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--dnb-coral-soft);
    border-left: 2.5px solid var(--dnb-coral);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-size: 12px;
    line-height: 1.55;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert-key {
    width: 64px;
    flex-shrink: 0;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dnb-coral);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert-row[data-tone="amber"] .dnb-editorial-alert-key {
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert-val {
    flex: 1;
    min-width: 0;
    color: var(--dnb-text);
    word-break: break-word;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-brief {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: 0;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-six-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 6px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--dnb-border);
    border-radius: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-row:last-child {
    border-bottom: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-tag {
    width: 64px;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    color: var(--dnb-text-3);
    font-size: 11.5px;
    font-weight: 450;
    line-height: 1.55;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-body {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--dnb-text-2);
    word-break: break-word;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-row[data-role="advice"] {
    background: var(--dnb-accent-soft);
    border: 1px solid var(--dnb-border-strong);
    border-left: 3px solid var(--dnb-accent);
    border-radius: 9px;
    padding: 9px 11px;
    margin-top: 6px;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-row[data-role="advice"] .dnb-six-tag {
    width: 56px;
    color: var(--dnb-accent);
    font-weight: 550;
  }
  .dnb-panel[data-dnb-skin] .dnb-six-row[data-role="advice"] .dnb-six-body {
    color: var(--dnb-text);
    font-weight: 480;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    padding-top: 9px;
    border-top: 1px solid var(--dnb-border);
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-btn {
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: 11.5px;
    color: var(--dnb-text-3);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    transition: color 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-btn:hover {
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-check {
    color: var(--dnb-sage);
    font-weight: 600;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-more {
    text-decoration: underline;
    text-underline-offset: 2px;
    opacity: 0.85;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-alert-badge {
    font-size: 11.5px;
    color: var(--dnb-coral);
    font-weight: 500;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-meta {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-meta > * + *::before {
    content: "·";
    margin-right: 7px;
    opacity: 0.65;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-meta-btn {
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    color: var(--dnb-text-3);
    cursor: pointer;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-meta-btn:hover {
    color: var(--dnb-accent);
    text-decoration: underline;
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-orig {
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--dnb-fill);
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-editorial-quiet-orig-key {
    color: var(--dnb-text-3);
  }

  /* Unboxed Key-Value Prose Rows (Replaces Colored Inline Pills in Structured Text) */
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row {
    display: flex;
    align-items: baseline;
    gap: 11px;
    padding: 5px 0;
    border-bottom: 1px solid var(--dnb-border);
    font-size: 12.2px;
    line-height: 1.58;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row:last-child {
    border-bottom: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-key {
    width: 78px;
    flex-shrink: 0;
    font-size: 11.5px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-val {
    flex: 1;
    min-width: 0;
    color: var(--dnb-text-2);
    word-break: break-word;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="accent"] .dnb-prose-kv-key {
    color: var(--dnb-accent);
    font-weight: 500;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="accent"] .dnb-prose-kv-val {
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="coral"] .dnb-prose-kv-key {
    color: var(--dnb-coral);
    font-weight: 550;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="coral"] .dnb-prose-kv-val {
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="amber"] .dnb-prose-kv-key {
    color: var(--dnb-amber);
    font-weight: 500;
  }
  .dnb-panel[data-dnb-skin] .dnb-prose-kv-row[data-tone="sage"] .dnb-prose-kv-key {
    color: var(--dnb-sage);
    font-weight: 500;
  }
  .dnb-panel[data-dnb-skin] .dnb-struct-head.is-compact {
    font-size: 11.8px;
    padding: 2px 6px;
    margin: 6px 0 4px;
  }

  /* Bounded Q&A & Log Section + L2 Turn Cards + L1 Reply Cards */
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-qa-section {
    margin-top: 10px;
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-qa-section > .dnb-acc-head {
    padding: 9px 13px;
    min-height: 36px;
  }
  .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-qa-section > .dnb-acc-body {
    padding: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-filter-quiet .dnb-text-filter-btn {
    border: 1px solid transparent;
    background: transparent;
    padding: 2px 7px;
    border-radius: 7px;
    font-size: 11.5px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-filter-quiet .dnb-text-filter-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-filter-quiet .dnb-text-filter-btn[data-active="1"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-accent);
    font-weight: 600;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-filter-sep {
    color: var(--dnb-border-strong);
    font-size: 11px;
    margin: 0 2px;
    user-select: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-stream {
    gap: 10px;
    padding: 10px 12px 12px;
    border-top: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box,
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box[data-turn-kind="system"] {
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-surface-sub);
    box-shadow: none;
    border-radius: 11px;
    overflow: hidden;
    padding: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box:last-child {
    border-bottom: 1px solid var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-question,
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question {
    background: var(--dnb-head-tint);
    border-bottom: 1px solid var(--dnb-border);
    padding: 8px 11px;
    border-radius: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box[data-collapsed="1"] .dnb-turn-question,
  .dnb-panel[data-dnb-skin] .dnb-turn-question[data-collapsed="1"],
  .dnb-panel[data-dnb-skin] .dnb-turn-question:last-child {
    border-bottom: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-question:hover,
  .dnb-panel[data-dnb-skin] .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-q-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-q-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-who {
    font-size: 11.5px;
    font-weight: 550;
    color: var(--dnb-accent);
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-who[data-role="system"] {
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-q-text {
    font-size: 12.8px;
    font-weight: 500;
    line-height: 1.5;
    color: var(--dnb-text);
    white-space: pre-wrap;
    word-break: break-word;
    min-width: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-q-text[data-clamped="1"] {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-img-pill {
    font-size: 11px;
    color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    padding: 0 6px;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-q-meta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--dnb-text-3);
    padding-top: 2px;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-replies {
    margin-left: 0;
    padding: 8px 10px 10px;
    border-left: none;
    gap: 6px;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-reply-item,
  .dnb-panel[data-dnb-skin] .dnb-turn-reply-item[data-role="receipt"],
  .dnb-panel[data-dnb-skin] .dnb-qa-card[data-role="chief"],
  .dnb-panel[data-dnb-skin] .dnb-receipt-card {
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    border-radius: 9px;
    padding: 6px 10px;
    transition: border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-panel[data-dnb-skin] .dnb-turn-reply-item:hover,
  .dnb-panel[data-dnb-skin] .dnb-turn-reply-item[data-role="receipt"]:hover {
    background: var(--dnb-card-hover);
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-btn {
    width: 100%;
    border: none;
    background: transparent;
    padding: 2px 0;
    font: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    text-align: left;
    cursor: pointer;
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-chevron {
    font-size: 11px;
    color: var(--dnb-text-3);
    flex-shrink: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-text {
    font-size: 12px;
    color: var(--dnb-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-summary-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    font-size: 11px;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-action-txt {
    font-size: 11px;
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-action-txt[data-tone="accent"] {
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-action-txt[data-tone="muted"] {
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-time {
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-short-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-detail {
    margin-top: 6px;
    padding: 7px 0 2px 14px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-reply-detail-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 6px;
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-receipt-badge {
    color: var(--dnb-sage);
    background: var(--dnb-sage-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-qa-badge[data-role="chief"] {
    color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-sug-card,
  .dnb-panel[data-dnb-skin] .dnb-disclaimer-box {
    border-radius: var(--dnb-radius-card, 13px);
    background: var(--dnb-amber-soft);
    border-color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-goal-approval-card {
    border-radius: var(--dnb-radius-card, 13px);
    background: var(--dnb-sage-soft);
    border-color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-bar {
    background: var(--dnb-skin-bg);
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-shell {
    border-radius: var(--dnb-radius-pill, 999px);
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-shell:focus-within {
    border-color: var(--dnb-accent);
    box-shadow: 0 0 0 2px var(--dnb-accent-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-chip {
    border-radius: var(--dnb-radius-pill, 999px);
  }
  .dnb-panel[data-dnb-skin] .dnb-sec-chip[data-active="1"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-tac-chip[data-tone="amber"] {
    background: var(--dnb-amber-soft);
    border-color: var(--dnb-amber);
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-tac-chip[data-tone="accent"] {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-tac-chip[data-tone="red"],
  .dnb-panel[data-dnb-skin] .dnb-stop-btn {
    background: var(--dnb-coral-soft);
    border-color: var(--dnb-coral);
    color: var(--dnb-coral);
    box-shadow: none;
  }

  /* Collab 2.0 (Peers Arena) Skin Harmonization */
  .dnb-panel[data-dnb-skin] .dnb-liquid-canvas {
    border-radius: var(--dnb-radius-panel, 20px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel[data-dnb-skin] .dnb-liquid-membrane {
    border-radius: var(--dnb-radius-card, 16px);
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-liquid-hub,
  .dnb-panel[data-dnb-skin] .dnb-liquid-lead-orb,
  .dnb-panel[data-dnb-skin] .dnb-liquid-sat-pill,
  .dnb-panel[data-dnb-skin] .dnb-liquid-ally-pill {
    background: var(--dnb-elevated);
    border-color: var(--dnb-border-strong);
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-liquid-hub-star {
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-liquid-run-badge {
    background: var(--dnb-sage-soft);
    border-color: var(--dnb-sage);
    color: var(--dnb-sage);
  }
  .dnb-panel[data-dnb-skin] .dnb-stream-box,
  .dnb-panel[data-dnb-skin] .dnb-mail-thread {
    border-radius: var(--dnb-radius-card, 13px);
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    box-shadow: var(--dnb-skin-shadow);
    overflow: hidden;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-threads {
    gap: 8px;
    padding: 0;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-thread[data-single="1"] {
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  .dnb-panel[data-dnb-skin] .dnb-stream-head,
  .dnb-panel[data-dnb-skin] .dnb-mail-thread-head {
    background: var(--dnb-head-tint);
    border-bottom: 1px solid var(--dnb-border);
    padding: 6px 12px;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-thread[data-open="1"] > .dnb-mail-thread-head {
    background: var(--dnb-head-tint);
    border-bottom-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-stream-tab {
    border-color: var(--dnb-border);
    color: var(--dnb-text-2);
  }
  .dnb-panel[data-dnb-skin] .dnb-stream-tab[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
    font-weight: 600;
  }
  .dnb-panel[data-dnb-skin] .dnb-chain-row {
    border-radius: calc(var(--dnb-radius-card, 13px) - 2px);
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-surface-sub);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="broadcast"],
  .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="cross"],
  .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="internal"] {
    color: var(--dnb-text-2);
    background: var(--dnb-fill);
    border-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-feed {
    padding: 10px 12px 12px;
    gap: 7px;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-msg {
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    border-left-width: 1px;
    border-left-color: var(--dnb-border);
    background: var(--dnb-surface-sub);
    padding: 0;
    overflow: hidden;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-msg:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-msg[data-expanded="1"] {
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-dot {
    background: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-dot[data-role="chief"] { background: var(--dnb-accent); }
  .dnb-panel[data-dnb-skin] .dnb-mail-dot[data-role="lead"] { background: var(--dnb-sage); }
  .dnb-panel[data-dnb-skin] .dnb-mail-dot[data-role="harness"] { background: var(--dnb-amber); }
  .dnb-panel[data-dnb-skin] .dnb-mail-dot[data-role="subagent"] { background: var(--dnb-accent); opacity: 0.72; }
  .dnb-panel[data-dnb-skin] .dnb-mail-mode {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--dnb-text-3);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-mode[data-mode="steer"] {
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-mode[data-mode="followup"] {
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-detail {
    border-top-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-detail-foot {
    border-top-color: var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-foot-btn {
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: 11px;
    color: var(--dnb-text-3);
    cursor: pointer;
  }
  .dnb-panel[data-dnb-skin] .dnb-mail-foot-btn:hover {
    color: var(--dnb-text);
  }

  /* Archives & Cognitive Desktop Skin Harmonization */
  .dnb-panel[data-dnb-skin] .dnb-desktop-zone {
    border-radius: var(--dnb-radius-card, 12px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    border-left: 3px solid var(--dnb-amber);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel[data-dnb-skin] .dnb-vault-banner {
    border-radius: var(--dnb-radius-card, 12px);
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-drawer-box,
  .dnb-panel[data-dnb-skin] .dnb-strip-bar {
    border-radius: var(--dnb-radius-card, 12px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-cabinet-drawer[data-open="1"] .dnb-drawer-box {
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-drawer-front {
    background: var(--dnb-head-tint);
  }
  .dnb-panel[data-dnb-skin] .dnb-drawer-well {
    background: var(--dnb-surface-sub);
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-dossier-card {
    border-radius: calc(var(--dnb-radius-card, 12px) - 1px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-dossier-card[data-open="1"] {
    border-color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-dossier-card[data-out="1"] {
    border-color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-mem-point {
    border-radius: calc(var(--dnb-radius-card, 12px) - 3px);
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-mem-point:hover,
  .dnb-panel[data-dnb-skin] .dnb-mem-point[data-open="1"] {
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-mem-point[data-open="1"] .dnb-mem-point-idx {
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-mini-btn {
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-mini-btn[data-tone="accent"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    color: var(--dnb-accent);
  }
  .dnb-panel[data-dnb-skin] .dnb-mini-btn[data-tone="amber"] {
    border-color: var(--dnb-amber);
    background: var(--dnb-amber-soft);
    color: var(--dnb-amber);
  }
  .dnb-panel[data-dnb-skin] .dnb-desk-tray {
    border-radius: var(--dnb-radius-card, 12px);
    background: var(--dnb-amber-soft);
    border-color: var(--dnb-amber);
  }

  /* Boundaries, Settings & Private Brain Clear Boundaries */
  .dnb-panel[data-dnb-skin] .dnb-group {
    border-radius: var(--dnb-radius-card, 14px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel[data-dnb-skin] .dnb-settings-bar {
    padding-bottom: 8px;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-bound-sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 2px 7px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--dnb-border);
    color: var(--dnb-text-2);
    font-weight: 600;
  }
  .dnb-panel[data-dnb-skin] .dnb-wall-item {
    border-radius: calc(var(--dnb-radius-card, 12px) - 1px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: var(--dnb-skin-shadow);
  }
  .dnb-panel[data-dnb-skin] .dnb-wall-item:hover {
    border-color: var(--dnb-accent);
    background: var(--dnb-card-hover);
  }
  .dnb-panel[data-dnb-skin] .dnb-tpl-drawer {
    background: var(--dnb-surface-sub);
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-panel[data-dnb-skin] .dnb-tpl-card {
    border-radius: calc(var(--dnb-radius-card, 12px) - 2px);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-tpl-card[data-active="1"] {
    border-color: color-mix(in srgb, var(--dnb-accent) 48%, var(--dnb-border-strong));
    background: color-mix(in srgb, var(--dnb-accent) 7%, var(--dnb-card));
  }
  .dnb-panel[data-dnb-skin] .dnb-tpl-card:hover {
    border-color: var(--dnb-accent);
    background: var(--dnb-card-hover);
  }

  /* Light Theme Compatibility Overrides for Route B/C & Harmonized Surfaces */
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-bento-hero { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-bento-ring-tile { background: var(--dnb-surface-sub); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-canvas { background-color: var(--dnb-surface-sub); background-image: radial-gradient(color-mix(in srgb, var(--dnb-text-3) 26%, transparent) 1px, transparent 1px); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-node[data-status="todo"] .dnb-beam-node-rect { fill: #ffffff; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-node[data-status="done"] .dnb-beam-node-rect { fill: color-mix(in srgb, var(--dnb-sage) 11%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-node[data-status="doing"] .dnb-beam-node-rect { fill: color-mix(in srgb, var(--dnb-accent) 11%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-node[data-status="blocked"] .dnb-beam-node-rect { fill: color-mix(in srgb, var(--dnb-coral) 11%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-agent-node[data-status="todo"] .dnb-beam-agent-rect { fill: #ffffff; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-agent-node[data-status="done"] .dnb-beam-agent-rect { fill: color-mix(in srgb, var(--dnb-sage) 10%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-agent-node[data-status="doing"] .dnb-beam-agent-rect { fill: color-mix(in srgb, var(--dnb-accent) 10%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-agent-node[data-status="blocked"] .dnb-beam-agent-rect { fill: color-mix(in srgb, var(--dnb-coral) 10%, #ffffff); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-drawer { background: var(--dnb-elevated); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-flow-stage { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="done"] { background: linear-gradient(90deg, var(--dnb-sage-soft) 0%, var(--dnb-card) 52%); border-color: var(--dnb-border); border-left-color: var(--dnb-sage); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="doing"] { background: linear-gradient(90deg, var(--dnb-accent-soft) 0%, var(--dnb-card) 58%); border-color: var(--dnb-border-strong); border-left-color: var(--dnb-accent); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-flow-stage[data-status="blocked"] { background: linear-gradient(90deg, var(--dnb-coral-soft) 0%, var(--dnb-card) 58%); border-color: var(--dnb-border); border-left-color: var(--dnb-coral); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-beam-idx[data-status="done"] { background: var(--dnb-sage); border-color: var(--dnb-sage); color: #ffffff; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-flow-step-num[data-status="done"] { background: var(--dnb-sage); border-color: var(--dnb-sage); color: #ffffff; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-text-filter-btn { background: var(--dnb-fill); border-color: var(--dnb-border); color: var(--dnb-text-2); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-text-filter-btn[data-active="1"] { background: var(--dnb-accent-soft); border-color: var(--dnb-accent); color: var(--dnb-accent); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mini-btn[data-tone="accent"] { background: var(--dnb-accent-soft); border-color: var(--dnb-accent); color: var(--dnb-accent); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mini-btn[data-tone="amber"] { background: var(--dnb-amber-soft); border-color: var(--dnb-amber); color: var(--dnb-amber); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-sec-bar { background: var(--dnb-skin-bg); border-top-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-canvas { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-membrane { background: var(--dnb-surface-sub); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-hub { background: var(--dnb-elevated); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-lead-orb { background: var(--dnb-elevated); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-sat-pill { background: var(--dnb-elevated); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-liquid-ally-pill { background: var(--dnb-elevated); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-stream-box { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-stream-head { background: var(--dnb-head-tint); border-bottom-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-stream-tab[data-active="1"] { background: var(--dnb-accent-soft); border-color: var(--dnb-accent); color: var(--dnb-accent); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-thread { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-thread[data-single="1"] { background: transparent; border: none; box-shadow: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-thread-head { background: var(--dnb-head-tint); border-bottom-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-thread[data-open="1"] > .dnb-mail-thread-head { background: var(--dnb-head-tint); border-bottom-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="broadcast"] { background: var(--dnb-fill); border-color: var(--dnb-border); color: var(--dnb-text-2); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="cross"] { background: var(--dnb-fill); border-color: var(--dnb-border); color: var(--dnb-text-2); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-channel-pill[data-kind="internal"] { background: var(--dnb-fill); border-color: var(--dnb-border); color: var(--dnb-text-2); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-msg { background: var(--dnb-surface-sub); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-msg:hover { background: var(--dnb-surface-sub); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-msg[data-expanded="1"] { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-mode { background: transparent; border: none; color: var(--dnb-text-3); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-mode[data-mode="steer"] { background: transparent; border: none; color: var(--dnb-amber); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-mode[data-mode="followup"] { background: transparent; border: none; color: var(--dnb-accent); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mail-body { color: var(--dnb-text-2); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-desktop-zone { background: var(--dnb-card); border-color: var(--dnb-border-strong); border-left-color: var(--dnb-amber); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-vault-banner { background: var(--dnb-surface-sub); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-drawer-box { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-drawer-front { background: var(--dnb-head-tint); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-drawer-well { background: var(--dnb-surface-sub); border-top-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-dossier-card { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-mem-point { background: var(--dnb-surface-sub); border-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-group { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-wall-item { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tpl-drawer { background: var(--dnb-surface-sub); border-bottom-color: var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tpl-card { background: var(--dnb-card); border-color: var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tpl-card[data-active="1"] { background: color-mix(in srgb, var(--dnb-accent) 6%, var(--dnb-card)); border-color: color-mix(in srgb, var(--dnb-accent) 52%, var(--dnb-border-strong)); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-acc-card.dnb-qa-section { background: var(--dnb-card); border: 1px solid var(--dnb-border-strong); box-shadow: var(--dnb-skin-shadow); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-qa-turn-box { background: var(--dnb-surface-sub); border: 1px solid var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-qa-turn-box:last-child { border-bottom: 1px solid var(--dnb-border-strong); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-question { background: var(--dnb-head-tint); border-bottom: 1px solid var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-qa-turn-box[data-collapsed="1"] .dnb-turn-question { border-bottom: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-question[data-collapsed="1"] { border-bottom: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-question:last-child { border-bottom: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-question:hover { background: var(--dnb-card-hover); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-reply-item { background: var(--dnb-card); border: 1px solid var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-turn-reply-item[data-role="receipt"] { background: var(--dnb-card); border: 1px solid var(--dnb-border); }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-qa-filter-quiet .dnb-text-filter-btn[data-active="1"] { background: var(--dnb-accent-soft); border-color: var(--dnb-border-strong); color: var(--dnb-accent); }

  /* ========================================================================
   * 8. Popover & Modal Opaque Layering Guard (Zero Bleed / Crisp Hierarchy)
   * ======================================================================== */

  .dnb-panel[data-dnb-skin] .dnb-menu,
  .dnb-panel[data-dnb-skin] .dnb-perm-pop,
  .dnb-panel[data-dnb-skin] .dnb-more-menu,
  .dnb-panel[data-dnb-skin] .dnb-tactical-pop,
  .dnb-panel[data-dnb-skin] .dnb-modal-card {
    background-color: var(--dnb-popover);
    background-image: none;
    border-color: var(--dnb-border-strong);
  }
  .dnb-panel[data-dnb-skin] .dnb-skin-pop { z-index: 145; background-color: var(--dnb-popover); background-image: none; }
  .dnb-panel[data-dnb-skin] .dnb-menu { z-index: 150; }
  .dnb-panel[data-dnb-skin] .dnb-perm-pop { z-index: 135; border-radius: var(--dnb-radius-card, 14px); }
  .dnb-panel[data-dnb-skin] .dnb-more-menu { z-index: 130; border-radius: var(--dnb-radius-card, 12px); }
  .dnb-panel[data-dnb-skin] .dnb-tactical-pop { z-index: 130; }
  .dnb-panel[data-dnb-skin] .dnb-modal-backdrop { z-index: 200; }
  .dnb-panel[data-dnb-skin] .dnb-perm-card {
    border-radius: calc(var(--dnb-radius-card, 12px) - 2px);
    border-color: var(--dnb-border);
    background: var(--dnb-fill);
  }
  .dnb-panel[data-dnb-skin] .dnb-perm-card[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-panel[data-dnb-skin] .dnb-perm-card[data-tier="chief"][data-active="1"] {
    border-color: var(--dnb-amber);
    background: var(--dnb-amber-soft);
  }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-menu { background-color: var(--dnb-popover); background-image: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-perm-pop { background-color: var(--dnb-popover); background-image: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-more-menu { background-color: var(--dnb-popover); background-image: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-tactical-pop { background-color: var(--dnb-popover); background-image: none; }
  html[data-ds-theme-source="light"] .dnb-panel[data-dnb-skin] .dnb-modal-card { background-color: var(--dnb-popover); background-image: none; }

  /* ========================================================================
   * 9. Custom DIY Theme Popover Row & Workshop Modal (.dnb-diy-modal)
   * ======================================================================== */

  .dnb-skin-pop-sep {
    height: 1px;
    background: var(--dnb-border);
    margin: 3px 6px;
  }
  .dnb-skin-pop-custom-row {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .dnb-skin-pop-custom-row > .dnb-skin-pop-item {
    flex: 1 1 auto;
    min-width: 0;
  }
  .dnb-skin-pop-edit-btn {
    flex-shrink: 0;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--dnb-radius-pill, 999px);
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-fill);
    color: var(--dnb-accent);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .dnb-skin-pop-edit-btn:hover {
    background: var(--dnb-accent-soft);
    border-color: var(--dnb-accent);
  }

  .dnb-diy-modal {
    max-width: 470px;
    gap: 11px;
  }
  .dnb-diy-tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
    padding: 4px;
    border-radius: calc(var(--dnb-radius-card, 12px) - 2px);
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
  }
  .dnb-diy-tab {
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    border-radius: calc(var(--dnb-radius-card, 12px) - 5px);
    padding: 7px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-diy-tab:hover {
    color: var(--dnb-text);
  }
  .dnb-diy-tab[data-active="1"] {
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-accent);
    font-weight: 600;
  }
  .dnb-diy-dropzone {
    border: 1.5px dashed var(--dnb-border-strong);
    border-radius: var(--dnb-radius-card, 12px);
    background: var(--dnb-surface-sub);
    padding: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .dnb-diy-dropzone:hover,
  .dnb-diy-dropzone[data-over="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-diy-thumb {
    width: 56px;
    height: 56px;
    border-radius: 10px;
    object-fit: cover;
    border: 1px solid var(--dnb-border-strong);
    flex-shrink: 0;
  }
  .dnb-diy-swatch-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .dnb-diy-swatch-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px 4px 5px;
    border-radius: 999px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: border-color 0.14s ease, transform 0.12s ease;
  }
  .dnb-diy-swatch-chip:hover {
    border-color: var(--dnb-accent);
    transform: translateY(-1px);
  }
  .dnb-diy-swatch-dot {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.25);
    flex-shrink: 0;
  }
  .dnb-diy-color-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  @media (max-width: 380px) {
    .dnb-diy-color-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .dnb-diy-slot-btn {
    border: 1px solid var(--dnb-border);
    background: var(--dnb-surface-sub);
    border-radius: 10px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    cursor: pointer;
    font: inherit;
    color: var(--dnb-text-2);
    font-size: 11px;
    transition: border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-diy-slot-btn[data-active="1"] {
    border-color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
    color: var(--dnb-text);
  }
  .dnb-diy-color-input {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
  }
  .dnb-diy-prompt-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .dnb-diy-chip {
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    border-radius: 999px;
    padding: 3px 9px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
  }
  .dnb-diy-chip:hover {
    border-color: var(--dnb-accent);
    color: var(--dnb-accent);
    background: var(--dnb-accent-soft);
  }
  .dnb-diy-preview {
    border: 1px solid var(--dnb-border-strong);
    background-color: var(--dnb-skin-bg);
    background-image: var(--dnb-skin-ambient, none);
    border-radius: var(--dnb-radius-card, 14px);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-diy-preview-card {
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    border-radius: calc(var(--dnb-radius-card, 14px) - 3px);
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .dnb-diy-bg-box {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--dnb-surface-sub);
    border: 1px solid var(--dnb-border);
  }
  .dnb-diy-slider-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  @media (max-width: 380px) {
    .dnb-diy-slider-grid { grid-template-columns: 1fr; }
  }
  .dnb-diy-slider-row {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .dnb-diy-range {
    flex: 1 1 auto;
    min-width: 0;
    accent-color: var(--dnb-accent);
    cursor: pointer;
  }

  /* ========================================================================
   * 10. Global Dual Navigation Layout (Top Classic Tabs vs Left Minimalist Studio Rail)
   * ======================================================================== */

  .dnb-workspace-host {
    container-type: inline-size;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .dnb-workspace-shell {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .dnb-workspace-rail {
    display: none;
  }
  @container (min-width: 680px) {
    .dnb-workspace-host[data-layout="sidebar"] > .dnb-seg-wrap {
      display: none;
    }
    .dnb-workspace-host[data-layout="sidebar"] > .dnb-workspace-shell {
      display: grid;
      grid-template-columns: 168px minmax(0, 1fr);
      gap: 0;
      padding: 6px 10px 0;
    }
    .dnb-workspace-host[data-layout="sidebar"] > .dnb-workspace-shell > .dnb-workspace-rail {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px 8px;
      border-radius: var(--dnb-radius-card, 14px);
      border: 1px solid var(--dnb-border);
      background: var(--dnb-card);
      box-shadow: var(--dnb-skin-shadow);
      overflow: visible;
      position: relative;
      z-index: 40;
    }
    .dnb-workspace-host[data-layout="sidebar"] > .dnb-workspace-shell > .dnb-body {
      padding: 0 4px 14px 12px;
      height: 100%;
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    .dnb-panel.dnb-main .dnb-workspace-host[data-layout="sidebar"] > .dnb-workspace-shell > .dnb-body > .dnb-view {
      max-width: none;
      width: 100%;
      margin-left: 0;
      margin-right: 0;
      box-sizing: border-box;
    }
    /* Hide duplicate horizontal sub-tab bars in left-rail studio mode */
    .dnb-workspace-host[data-layout="sidebar"] .dnb-vault-seg {
      display: none;
    }
    /* Single-card view when clicking left-rail sub-tabs */
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="chief:digest"] [data-dnb-section="chief-chat"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="chief:chat"] [data-dnb-section="chief-digest"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="tasks:plan"] [data-dnb-section="tasks-handoff"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="tasks:board"] [data-dnb-section="tasks-plan"],
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="tasks:board"] [data-dnb-section="tasks-handoff"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="tasks:handoff"] [data-dnb-section="tasks-plan"],
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="tasks:handoff"] [data-dnb-section="tasks-board"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="peers:net"] [data-dnb-section="peers-mail"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="peers:mail"] [data-dnb-section="peers-net"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:walls"] [data-dnb-section="bound-rules"],
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:walls"] [data-dnb-section="bound-env"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:rules"] [data-dnb-section="bound-walls"],
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:rules"] [data-dnb-section="bound-env"] { display: none; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:rules"] [data-dnb-section="bound-rules"] .dnb-bound-sec-head { margin-top: 0 !important; }
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:env"] [data-dnb-section="bound-walls"],
    .dnb-workspace-host[data-layout="sidebar"][data-rail-sub="boundaries:env"] [data-dnb-section="bound-rules"] { display: none; }
  }
  .dnb-head-rail-moved {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }
  @container dnb-head (min-width: 680px) {
    .dnb-panel[data-dnb-nav-layout="sidebar"] .dnb-head-rail-moved {
      display: none;
    }
  }
  .dnb-skin-pop.dnb-skin-pop-rail {
    top: auto;
    bottom: 0;
    left: calc(100% + 8px);
    z-index: 160;
  }
  .dnb-workspace-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--dnb-text-3);
    transition: transform 0.16s ease, color 0.16s ease;
    transform: rotate(0deg);
    flex-shrink: 0;
  }
  .dnb-workspace-chevron[data-open="1"] {
    transform: rotate(90deg);
    color: var(--dnb-accent);
  }
  .dnb-workspace-rail-head {
    padding: 2px 6px 8px;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-workspace-rail-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  .dnb-workspace-nav-btn {
    appearance: none;
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    border-radius: 9px;
    padding: 7px 9px;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    text-align: left;
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-workspace-nav-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-workspace-nav-btn[data-active="1"] {
    background: var(--dnb-accent-soft, rgba(139, 124, 246, 0.16));
    border-color: color-mix(in srgb, var(--dnb-accent, #8b7cf6) 42%, transparent);
    color: var(--dnb-text);
    font-weight: 600;
  }
  .dnb-workspace-rail-badge {
    font-size: 10px;
    color: var(--dnb-text-3);
    font-variant-numeric: tabular-nums;
  }
  .dnb-workspace-nav-btn[data-active="1"] .dnb-workspace-rail-badge {
    color: var(--dnb-accent);
  }
  .dnb-workspace-subnav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0 4px 18px;
  }
  .dnb-workspace-sub-btn {
    appearance: none;
    border: none;
    border-left: 1.5px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-3);
    padding: 4px 8px;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
    border-radius: 0 6px 6px 0;
    transition: color 0.13s ease, border-color 0.13s ease, background 0.13s ease;
  }
  .dnb-workspace-sub-btn:hover {
    color: var(--dnb-text);
    background: var(--dnb-fill);
  }
  .dnb-workspace-sub-btn[data-active="1"] {
    color: var(--dnb-accent);
    border-left-color: var(--dnb-accent);
    font-weight: 600;
  }
  .dnb-workspace-rail-foot {
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--dnb-border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
`
