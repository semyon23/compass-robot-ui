import { useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { setOperatingMode } from '../api/robot'
import { errorText } from '../lib/errorText'

/**
 * Смена режима работы и передача робота fms (ROS_INTERFACES §3.1).
 * «Передать fms» — AUTOMATIC. «Перехватить» — с подтверждением: есть задание fms — INTERVENED
 * (робот стоит, задание сохраняется до «Передать fms»), нет — MANUAL.
 */
export function useFmsHandover() {
  const { t } = useI18n()
  const message = useMessage()
  const dialog = useDialog()
  const robot = useRobotStore()

  async function change(target) {
    try {
      await setOperatingMode(target)
      message.success(t('modeSwitch.changed', { mode: t(`mode.${target}`) }))
    } catch (e) {
      message.error(errorText(e))
    }
  }

  function takeOver() {
    const withOrder = !!robot.fms?.orderActive
    dialog.warning({
      title: t('modeSwitch.takeOver'),
      content: t(withOrder ? 'modeSwitch.takeOverOrder' : 'modeSwitch.takeOverIdle'),
      positiveText: t('modeSwitch.takeOver'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => change(withOrder ? 'INTERVENED' : 'MANUAL'),
    })
  }

  return { change, handOver: () => change('AUTOMATIC'), takeOver }
}
