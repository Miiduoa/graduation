import type { ImageSourcePropType } from 'react-native';

/**
 * 語意化按鈕／導覽圖示（`apps/mobile/assets/generated-icons/`）。
 *
 * 佔位圖：`python3 scripts/seed-button-icon-placeholders.py`
 * Flux 再生：`python3 scripts/generate-button-icons-comfyui.py --width 512 --height 512`
 * （可依需求再以 `sips -z 96 96` 等方式縮放到 1x／2x／3x 策略）
 */
export const generatedButtonIcons = {
  ic_tab_today: require('../../assets/generated-icons/ic_tab_today.png'),
  ic_tab_study: require('../../assets/generated-icons/ic_tab_study.png'),
  ic_tab_campus: require('../../assets/generated-icons/ic_tab_campus.png'),
  ic_tab_messages: require('../../assets/generated-icons/ic_tab_messages.png'),
  ic_profile: require('../../assets/generated-icons/ic_profile.png'),
  ic_close: require('../../assets/generated-icons/ic_close.png'),
  ic_chevron_forward: require('../../assets/generated-icons/ic_chevron_forward.png'),
  ic_session_expired_clock: require('../../assets/generated-icons/ic_session_expired_clock.png'),
  ic_warning_triangle: require('../../assets/generated-icons/ic_warning_triangle.png'),
  ic_search: require('../../assets/generated-icons/ic_search.png'),
  ic_clear_circle: require('../../assets/generated-icons/ic_clear_circle.png'),
  ic_ai_sparkles: require('../../assets/generated-icons/ic_ai_sparkles.png'),
  ic_navigate_pin: require('../../assets/generated-icons/ic_navigate_pin.png'),
  ic_ar_glasses: require('../../assets/generated-icons/ic_ar_glasses.png'),
  ic_people_community: require('../../assets/generated-icons/ic_people_community.png'),
  ic_restaurant: require('../../assets/generated-icons/ic_restaurant.png'),
  ic_library: require('../../assets/generated-icons/ic_library.png'),
  ic_dorm: require('../../assets/generated-icons/ic_dorm.png'),
  ic_bus: require('../../assets/generated-icons/ic_bus.png'),
  ic_print: require('../../assets/generated-icons/ic_print.png'),
  ic_health_heart: require('../../assets/generated-icons/ic_health_heart.png'),
  ic_lost_found: require('../../assets/generated-icons/ic_lost_found.png'),
  ic_accessibility: require('../../assets/generated-icons/ic_accessibility.png'),
  ic_payment_card: require('../../assets/generated-icons/ic_payment_card.png'),
  ic_ar_nav_badge: require('../../assets/generated-icons/ic_ar_nav_badge.png'),
  ic_globe_social: require('../../assets/generated-icons/ic_globe_social.png'),
  ic_qr_code: require('../../assets/generated-icons/ic_qr_code.png'),
  ic_trophy: require('../../assets/generated-icons/ic_trophy.png'),
  ic_school: require('../../assets/generated-icons/ic_school.png'),
  ic_notifications: require('../../assets/generated-icons/ic_notifications.png'),
  ic_options: require('../../assets/generated-icons/ic_options.png'),
  ic_settings: require('../../assets/generated-icons/ic_settings.png'),
  ic_ai_chip: require('../../assets/generated-icons/ic_ai_chip.png'),
  ic_grid_widgets: require('../../assets/generated-icons/ic_grid_widgets.png'),
  ic_admin_shield: require('../../assets/generated-icons/ic_admin_shield.png'),
  ic_verify: require('../../assets/generated-icons/ic_verify.png'),
  ic_analytics_chart: require('../../assets/generated-icons/ic_analytics_chart.png'),
  ic_facilities_wrench: require('../../assets/generated-icons/ic_facilities_wrench.png'),
  ic_store_merchant: require('../../assets/generated-icons/ic_store_merchant.png'),
  ic_privacy_export: require('../../assets/generated-icons/ic_privacy_export.png'),
  ic_trash_delete: require('../../assets/generated-icons/ic_trash_delete.png'),
  ic_help: require('../../assets/generated-icons/ic_help.png'),
  ic_feedback_chat: require('../../assets/generated-icons/ic_feedback_chat.png'),
  ic_bug_report: require('../../assets/generated-icons/ic_bug_report.png'),
} satisfies Record<string, ImageSourcePropType>;

export type GeneratedButtonIconId = keyof typeof generatedButtonIcons;
