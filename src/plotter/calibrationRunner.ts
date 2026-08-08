import {
  createJogCommands,
  createOriginCommands,
  createPenCommand,
} from './job'

function probeCommands(profile) {
  if (profile === 'marlin') return ['M115']
  if (profile === 'ebb') return ['V']
  return ['$I']
}

export function calibrationCommands(action, config) {
  const step = Number(config.calibrationStep)
  const width = Number(config.workAreaWidth)
  const height = Number(config.workAreaHeight)
  switch (action) {
    case 'probe': return probeCommands(config.profile)
    case 'axis-x-negative': return createJogCommands(-step, 0, config)
    case 'axis-x-positive': return createJogCommands(step, 0, config)
    case 'axis-y-negative': return createJogCommands(0, -step, config)
    case 'axis-y-positive': return createJogCommands(0, step, config)
    case 'pen-up':
      if (config.penMode === 'laser') throw new Error('Мастер не активирует лазер.')
      return createPenCommand(true, config)
    case 'pen-down':
      if (config.penMode === 'laser') throw new Error('Мастер не активирует лазер.')
      return createPenCommand(false, config)
    case 'origin': return createOriginCommands(config)
    case 'boundary-right': return createJogCommands(width, 0, config)
    case 'boundary-bottom': return createJogCommands(0, height, config)
    case 'boundary-left': return createJogCommands(-width, 0, config)
    case 'boundary-home': return createJogCommands(0, -height, config)
    default: throw new Error('Неизвестный шаг калибровки.')
  }
}

export async function runCalibrationAction(action, config, sendCommands) {
  const commands = calibrationCommands(action, config)
  if (commands.length) await sendCommands(commands)
  return commands
}
