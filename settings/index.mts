import type {
  ErrorDetails,
  ErrorLog,
  ErrorLogQuery,
  FrostProtectionData,
  FrostProtectionQuery,
  HolidayModeData,
  HolidayModeQuery,
  LoginCredentials,
  ZoneSettings,
} from '@olivierzal/melcloud-api'
import type Homey from 'homey/lib/HomeySettings'

import type {
  BuildingZone,
  DeviceSetting,
  DeviceSettings,
  DriverSetting,
  HomeySettings,
  LoginDriverSetting,
  Settings,
  ValueOf,
  Zone,
} from '../types/common.mts'

type HTMLValueElement = HTMLInputElement | HTMLSelectElement

class NoDeviceError extends Error {
  public constructor(homey: Homey) {
    super(homey.__('settings.devices.none'))
  }
}

const SIZE_ONE = 1

const MODULUS_DECIMAL = 10
const MODULUS_HUNDRED = 100
const NUMBER_END_2 = 2
const NUMBER_END_3 = 3
const NUMBER_END_4 = 4
const PLURAL_EXCEPTION_12 = 12
const PLURAL_EXCEPTION_13 = 13
const PLURAL_EXCEPTION_14 = 14
const PLURAL_THRESHOLD = 2

const frostProtectionTemperatureRange = { max: 16, min: 4 } as const
const FROST_PROTECTION_TEMPERATURE_GAP = 2

const zoneMapping: Partial<Record<string, Partial<ZoneSettings>>> = {}

const getButtonElement = (id: string): HTMLButtonElement => {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error('Element is not a button')
  }
  return element
}

const getDivElement = (id: string): HTMLDivElement => {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) {
    throw new Error('Element is not a div')
  }
  return element
}

const getInputElement = (id: string): HTMLInputElement => {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('Element is not an input')
  }
  return element
}

const getLabelElement = (id: string): HTMLLabelElement => {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLLabelElement)) {
    throw new Error('Element is not a label')
  }
  return element
}

const getSelectElement = (id: string): HTMLSelectElement => {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('Element is not a select')
  }
  return element
}

const authenticateElement = getButtonElement('authenticate')
const autoAdjustElement = getButtonElement('auto_adjust')
const refreshFrostProtectionElement = getButtonElement(
  'refresh_frost_protection',
)
const refreshHolidayModeElement = getButtonElement('refresh_holiday_mode')
const seeElement = getButtonElement('see')
const updateFrostProtectionElement = getButtonElement('apply_frost_protection')
const updateHolidayModeElement = getButtonElement('apply_holiday_mode')

const authenticatedElement = getDivElement('authenticated')
const authenticatingElement = getDivElement('authenticating')
const errorLogElement = getDivElement('error_log')
const loginElement = getDivElement('login')
const settingsCommonElement = getDivElement('settings_common')

const sinceElement = getInputElement('since')
const frostProtectionMinTemperatureElement = getInputElement('min')
frostProtectionMinTemperatureElement.min = String(
  frostProtectionTemperatureRange.min,
)
frostProtectionMinTemperatureElement.max = String(
  frostProtectionTemperatureRange.max - FROST_PROTECTION_TEMPERATURE_GAP,
)
const frostProtectionMaxTemperatureElement = getInputElement('max')
frostProtectionMaxTemperatureElement.min = String(
  frostProtectionTemperatureRange.min + FROST_PROTECTION_TEMPERATURE_GAP,
)
frostProtectionMaxTemperatureElement.max = String(
  frostProtectionTemperatureRange.max,
)
const holidayModeStartDateElement = getInputElement('start_date')
const holidayModeEndDateElement = getInputElement('end_date')

const errorCountLabelElement = getLabelElement('error_count')
const periodLabelElement = getLabelElement('period')

const zoneElement = getSelectElement('zones')
const frostProtectionEnabledElement = getSelectElement(
  'enabled_frost_protection',
)
const holidayModeEnabledElement = getSelectElement('enabled_holiday_mode')

let deviceSettings: Partial<DeviceSettings> = {}
let flatDeviceSettings: Partial<DeviceSetting> = {}

let usernameElement: HTMLInputElement | null = null
let passwordElement: HTMLInputElement | null = null

let errorLogTBodyElement: HTMLTableSectionElement | null = null
let errorCount = 0
let from = ''
let to = ''

const getZoneId = (id: number, model: string): string =>
  `${model}_${String(id)}`
const getZoneName = (name: string, level: number): string =>
  `${'···'.repeat(level)} ${name}`
const getZonePath = (): string => zoneElement.value.replace('_', '/')

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const disableButton = (id: string, value = true): void => {
  const element = document.getElementById(id)
  if (value) {
    element?.classList.add('is-disabled')
    return
  }
  element?.classList.remove('is-disabled')
}

const enableButton = (id: string, value = true): void => {
  disableButton(id, !value)
}

const disableButtons = (id: string, value = true): void => {
  const isCommon = id.endsWith('common')
  ;['apply', 'refresh'].forEach((action) => {
    disableButton(`${action}_${id}`, value)
    if (isCommon) {
      Object.keys(deviceSettings).forEach((driverId) => {
        disableButton(`${action}_${id.replace(/common$/u, driverId)}`, value)
      })
    }
  })
}

const enableButtons = (id: string, value = true): void => {
  disableButtons(id, !value)
}

const disableSettingButtons = (): void => {
  disableButton(seeElement.id)
  disableButtons('frost_protection')
  disableButtons('holiday_mode')
  disableButtons('settings_common')
}

const withDisablingButton = async (
  id: string,
  action: () => Promise<void>,
): Promise<void> => {
  disableButton(id)
  await action()
  enableButton(id)
}

const withDisablingButtons = async (
  id: string,
  action: () => Promise<void>,
): Promise<void> => {
  disableButtons(id)
  await action()
  enableButtons(id)
}

const hide = (element: HTMLDivElement, value = true): void => {
  element.classList.toggle('hidden', value)
}

const unhide = (element: HTMLDivElement, value = true): void => {
  hide(element, !value)
}

const setDocumentLanguage = async (homey: Homey): Promise<void> =>
  new Promise((resolve) => {
    homey.api('GET', '/language', (error: Error | null, language: string) => {
      if (!error) {
        document.documentElement.lang = language
      }
      resolve()
    })
  })

const fetchHomeySettings = async (homey: Homey): Promise<HomeySettings> =>
  new Promise((resolve) => {
    homey.get(async (error: Error | null, settings: HomeySettings) => {
      if (error) {
        await homey.alert(error.message)
        resolve({})
        return
      }
      resolve(settings)
    })
  })

const fetchFlattenDeviceSettings = (): void => {
  flatDeviceSettings = Object.fromEntries(
    Object.entries(
      Object.groupBy(
        Object.values(deviceSettings).flatMap((settings) =>
          Object.entries(settings ?? {}).map(([id, values]) => ({
            id,
            values,
          })),
        ),
        ({ id }) => id,
      ),
    ).map(([id, groupedValues]) => {
      const set = new Set(groupedValues?.map(({ values }) => values))
      return [id, set.size === SIZE_ONE ? set.values().next().value : null]
    }),
  )
}

const fetchDeviceSettings = async (homey: Homey): Promise<void> =>
  new Promise((resolve) => {
    homey.api(
      'GET',
      '/settings/devices',
      async (error: Error | null, settings: DeviceSettings) => {
        if (error) {
          await homey.alert(error.message)
        } else {
          deviceSettings = settings
          fetchFlattenDeviceSettings()
        }
        resolve()
      },
    )
  })

const addTextToCheckbox = (
  labelElement: HTMLLabelElement,
  checkboxElement: HTMLInputElement,
  text: string,
): void => {
  const checkmarkSpanElement = document.createElement('span')
  checkmarkSpanElement.classList.add('homey-form-checkbox-checkmark')
  const textSpanElement = document.createElement('span')
  textSpanElement.classList.add('homey-form-checkbox-text')
  textSpanElement.innerText = text
  labelElement.append(checkboxElement, checkmarkSpanElement, textSpanElement)
}

const createLabelElement = (
  valueElement: HTMLValueElement,
  text: string,
): HTMLLabelElement => {
  const isCheckbox = valueElement.type === 'checkbox'
  const labelElement = document.createElement('label')
  labelElement.classList.add(
    isCheckbox ? 'homey-form-checkbox' : 'homey-form-label',
  )
  ;({ id: labelElement.htmlFor } = valueElement)
  if (isCheckbox) {
    addTextToCheckbox(labelElement, valueElement, text)
  } else {
    labelElement.innerText = text
    labelElement.append(valueElement)
  }
  return labelElement
}

const createDivElement = (labelElement: HTMLLabelElement): HTMLDivElement => {
  const divElement = document.createElement('div')
  divElement.classList.add('homey-form-group')
  divElement.append(labelElement)
  return divElement
}

const createValueElement = (
  parentElement: HTMLElement,
  {
    title,
    valueElement,
  }: { title: string; valueElement: HTMLValueElement | null },
  wrapWithDiv = true,
): void => {
  if (valueElement) {
    const labelElement = createLabelElement(valueElement, title)
    parentElement.append(
      wrapWithDiv ? createDivElement(labelElement) : labelElement,
    )
  }
}

const handleNumericInputElement = (
  inputElement: HTMLInputElement,
  { max, min }: { max?: number; min?: number },
): void => {
  if (inputElement.type === 'number') {
    inputElement.setAttribute('inputmode', 'numeric')
    if (min !== undefined) {
      inputElement.min = String(min)
    }
    if (max !== undefined) {
      inputElement.max = String(max)
    }
  }
}

const createInputElement = ({
  id,
  max,
  min,
  placeholder,
  type,
  value,
}: {
  id: string
  type: string
  max?: number
  min?: number
  placeholder?: string
  value?: string | null
}): HTMLInputElement => {
  const inputElement = document.createElement('input')
  inputElement.classList.add('homey-form-input')
  inputElement.id = id
  inputElement.value = value ?? ''
  inputElement.type = type
  handleNumericInputElement(inputElement, { max, min })
  if (placeholder !== undefined) {
    inputElement.placeholder = placeholder
  }
  return inputElement
}

const createLegendElement = (
  fieldSetElement: HTMLFieldSetElement,
  text?: string,
): void => {
  const legendElement = document.createElement('legend')
  legendElement.classList.add('homey-form-checkbox-set-title')
  if (text !== undefined) {
    legendElement.innerText = text
  }
  fieldSetElement.append(legendElement)
}

const createCheckboxElement = (
  id: string,
  driverId: string,
): HTMLInputElement => {
  const checkboxElement = document.createElement('input')
  checkboxElement.classList.add('homey-form-checkbox-input')
  checkboxElement.type = 'checkbox'
  checkboxElement.id = `${id}__settings_${driverId}`
  return checkboxElement
}

const createOptionElement = (
  selectElement: HTMLSelectElement,
  { id, label }: { id: string; label: string },
): void => {
  if (!selectElement.querySelector(`option[value="${id}"]`)) {
    selectElement.append(new Option(label, id))
  }
}

const createSelectElement = (
  homey: Homey,
  id: string,
  values?: readonly { id: string; label: string }[],
): HTMLSelectElement => {
  const selectElement = document.createElement('select')
  selectElement.classList.add('homey-form-select')
  selectElement.id = id
  ;[
    { id: '', label: '' },
    ...(values ??
      ['false', 'true'].map((value) => ({
        id: value,
        label: homey.__(`settings.boolean.${value}`),
      }))),
  ].forEach((option) => {
    createOptionElement(selectElement, option)
  })
  return selectElement
}

const updateCommonSetting = (element: HTMLSelectElement): void => {
  const [id] = element.id.split('__')
  const { [id]: value } = flatDeviceSettings
  element.value = value === null ? '' : String(value)
}

const refreshCommonSettings = (elements: HTMLSelectElement[]): void => {
  elements.forEach(updateCommonSetting)
}

const updateDriverSetting = (
  element: HTMLInputElement,
  driverId: string,
): void => {
  const [id] = element.id.split('__')
  const isChecked = deviceSettings[driverId]?.[id]
  if (typeof isChecked === 'boolean') {
    element.checked = isChecked
    return
  }
  element.indeterminate = true
  element.addEventListener('change', () => {
    if (element.indeterminate) {
      element.indeterminate = false
    }
  })
}

const refreshDriverSettings = (
  elements: HTMLInputElement[],
  driverId: string,
): void => {
  elements.forEach((element) => {
    updateDriverSetting(element, driverId)
  })
}

const int = (
  homey: Homey,
  { id, max, min, value }: HTMLInputElement,
): number => {
  const numberValue = Number(value)
  if (
    !Number.isFinite(numberValue) ||
    numberValue < Number(min) ||
    numberValue > Number(max)
  ) {
    throw new Error(
      homey.__('settings.intError', {
        max,
        min,
        name: homey.__(
          document.querySelector<HTMLLabelElement>(`label[for="${id}"]`)
            ?.innerText ?? '',
        ),
      }),
    )
  }
  return numberValue
}

const shouldUpdate = (
  id: string,
  value: ValueOf<Settings>,
  driverId?: string,
): boolean => {
  if (value !== null) {
    const setting =
      driverId === undefined ?
        flatDeviceSettings[id]
      : deviceSettings[driverId]?.[id]
    return setting === null ? true : value !== setting
  }
  return false
}

const processValue = (
  homey: Homey,
  element: HTMLValueElement,
): ValueOf<Settings> => {
  if (element.value) {
    if (element.type === 'checkbox') {
      return element.indeterminate ? null : element.checked
    }
    if (element.type === 'number' && element.min !== '' && element.max !== '') {
      return int(homey, element)
    }
    if (['false', 'true'].includes(element.value)) {
      return element.value === 'true'
    }
    const numberValue = Number(element.value)
    return Number.isFinite(numberValue) ? numberValue : element.value
  }
  return null
}

const buildSettingsBody = (
  homey: Homey,
  elements: HTMLValueElement[],
  driverId?: string,
): Settings => {
  const errors: string[] = []
  const settings: Settings = {}
  elements.forEach((element) => {
    try {
      const [id] = element.id.split('__')
      const value = processValue(homey, element)
      if (shouldUpdate(id, value, driverId)) {
        settings[id] = value
      }
    } catch (error) {
      errors.push(getErrorMessage(error))
    }
  })
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
  return settings
}

const updateDeviceSettings = (body: Settings, driverId?: string): void => {
  if (driverId !== undefined) {
    Object.entries(body).forEach(([id, value]) => {
      deviceSettings[driverId] ??= {}
      deviceSettings[driverId][id] = value
    })
    fetchFlattenDeviceSettings()
    return
  }
  Object.entries(body).forEach(([id, value]) => {
    Object.keys(deviceSettings).forEach((driver) => {
      deviceSettings[driver] ??= {}
      deviceSettings[driver][id] = value
    })
    flatDeviceSettings[id] = value
  })
}

const setDeviceSettings = async (
  homey: Homey,
  elements: HTMLValueElement[],
  driverId?: string,
): Promise<void> => {
  const body = buildSettingsBody(homey, elements, driverId)
  if (!Object.keys(body).length) {
    if (driverId === undefined) {
      refreshCommonSettings(
        elements.filter((element) => element instanceof HTMLSelectElement),
      )
    }
    homey.alert(homey.__('settings.devices.apply.nothing')).catch(() => {
      //
    })
    return
  }
  await withDisablingButtons(
    `settings_${driverId ?? 'common'}`,
    async () =>
      new Promise((resolve) => {
        homey.api(
          'PUT',
          `/settings/devices${
            driverId === undefined ? '' : (
              `?${new URLSearchParams({ driverId } satisfies {
                driverId: string
              })}`
            )
          }`,
          body satisfies Settings,
          async (error: Error | null) => {
            if (!error) {
              updateDeviceSettings(body, driverId)
            }
            await homey.alert(
              error ? error.message : homey.__('settings.success'),
            )
            resolve()
          },
        )
      }),
  )
}

const addApplySettingsEventListener = (
  homey: Homey,
  elements: HTMLValueElement[],
  driverId?: string,
): void => {
  const settings = `settings_${driverId ?? 'common'}`
  const buttonElement = getButtonElement(`apply_${settings}`)
  buttonElement.addEventListener('click', () => {
    setDeviceSettings(homey, elements, driverId).catch(() => {
      //
    })
  })
}

const addRefreshSettingsEventListener = (
  elements: HTMLValueElement[],
  driverId?: string,
): void => {
  const settings = `settings_${driverId ?? 'common'}`
  const buttonElement = getButtonElement(`refresh_${settings}`)
  buttonElement.addEventListener('click', () => {
    if (driverId !== undefined) {
      refreshDriverSettings(
        elements.filter((element) => element instanceof HTMLInputElement),
        driverId,
      )
      return
    }
    refreshCommonSettings(
      elements.filter((element) => element instanceof HTMLSelectElement),
    )
  })
}

const addSettingsEventListeners = (
  homey: Homey,
  elements: HTMLValueElement[],
  driverId?: string,
): void => {
  addApplySettingsEventListener(homey, elements, driverId)
  addRefreshSettingsEventListener(elements, driverId)
}

const generateCommonSettings = (
  homey: Homey,
  driverSettings: Partial<Record<string, DriverSetting[]>>,
): void => {
  ;(driverSettings.options ?? []).forEach(({ id, title, type, values }) => {
    const settingId = `${id}__setting`
    if (
      !settingsCommonElement.querySelector(`select[id="${settingId}"]`) &&
      ['checkbox', 'dropdown'].includes(type)
    ) {
      const valueElement = createSelectElement(homey, settingId, values)
      createValueElement(settingsCommonElement, { title, valueElement })
      updateCommonSetting(valueElement)
    }
  })
  addSettingsEventListeners(
    homey,
    Array.from(settingsCommonElement.querySelectorAll('select')),
  )
}

const generateDriverSettings = (
  homey: Homey,
  driverSettings: Partial<Record<string, DriverSetting[]>>,
  driverId: string,
): void => {
  if (driverSettings[driverId]) {
    const settingsElement = document.getElementById(`settings_${driverId}`)
    if (settingsElement) {
      const fieldSetElement = document.createElement('fieldset')
      fieldSetElement.classList.add('homey-form-checkbox-set')
      let previousGroupLabel = ''
      driverSettings[driverId].forEach(({ groupLabel, id, title, type }) => {
        if (type === 'checkbox') {
          if (groupLabel !== previousGroupLabel) {
            previousGroupLabel = groupLabel ?? ''
            createLegendElement(fieldSetElement, groupLabel)
          }
          const valueElement = createCheckboxElement(id, driverId)
          createValueElement(fieldSetElement, { title, valueElement }, false)
          updateDriverSetting(valueElement, driverId)
        }
      })
      settingsElement.append(fieldSetElement)
      addSettingsEventListeners(
        homey,
        Array.from(fieldSetElement.querySelectorAll('input')),
        driverId,
      )
      unhide(getDivElement(`has_devices_${driverId}`))
    }
  }
}

const generateSettings = (
  homey: Homey,
  driverSettings: Partial<Record<string, DriverSetting[]>>,
): void => {
  generateCommonSettings(homey, driverSettings)
  Object.keys(deviceSettings).forEach((driverId) => {
    generateDriverSettings(homey, driverSettings, driverId)
  })
}

const generateCredential = (
  credentialKey: keyof LoginCredentials,
  driverSettings: Partial<Record<string, DriverSetting[]>>,
  value?: string | null,
): HTMLInputElement | null => {
  const loginSetting = driverSettings.login?.find(
    (setting): setting is LoginDriverSetting => setting.id === credentialKey,
  )
  if (loginSetting) {
    const { id, placeholder, title, type } = loginSetting
    const valueElement = createInputElement({
      id,
      placeholder,
      type,
      value,
    })
    createValueElement(loginElement, { title, valueElement })
    return valueElement
  }
  return null
}

const generateCredentials = (
  driverSettings: Partial<Record<string, DriverSetting[]>>,
  credentials: { password?: string | null; username?: string | null },
): void => {
  ;[usernameElement, passwordElement] = (['username', 'password'] as const).map(
    (element) =>
      generateCredential(element, driverSettings, credentials[element]),
  )
}

const fetchDriverSettings = async (
  homey: Homey,
  credentials: { password?: string | null; username?: string | null },
): Promise<void> =>
  new Promise((resolve) => {
    homey.api(
      'GET',
      '/settings/drivers',
      async (
        error: Error | null,
        settings: Partial<Record<string, DriverSetting[]>>,
      ) => {
        if (error) {
          await homey.alert(error.message)
        } else {
          generateSettings(homey, settings)
          generateCredentials(settings, credentials)
        }
        resolve()
      },
    )
  })

const generateErrorLogTable = (
  homey: Homey,
  keys: string[],
): HTMLTableSectionElement => {
  const tableElement = document.createElement('table')
  tableElement.classList.add('bordered')
  const theadElement = tableElement.createTHead()
  const rowElement = theadElement.insertRow()
  keys.forEach((key) => {
    const thElement = document.createElement('th')
    thElement.innerText = homey.__(`settings.errorLog.columns.${key}`)
    rowElement.append(thElement)
  })
  errorLogElement.append(tableElement)
  return tableElement.createTBody()
}

const generateErrorLogTableData = (
  homey: Homey,
  errors: ErrorDetails[],
): void => {
  errors.forEach((error) => {
    if (!errorLogTBodyElement) {
      errorLogTBodyElement = generateErrorLogTable(homey, Object.keys(error))
    }
    const rowElement = errorLogTBodyElement.insertRow()
    Object.values(error).forEach((value: string) => {
      const cellElement = rowElement.insertCell()
      cellElement.innerText = value
    })
  })
}

const getErrorCountText = (homey: Homey, count: number): string => {
  if (count < PLURAL_THRESHOLD) {
    return homey.__(`settings.errorLog.errorCount.${String(count)}`)
  }
  if (
    [NUMBER_END_2, NUMBER_END_3, NUMBER_END_4].includes(
      count % MODULUS_DECIMAL,
    ) &&
    ![PLURAL_EXCEPTION_12, PLURAL_EXCEPTION_13, PLURAL_EXCEPTION_14].includes(
      count % MODULUS_HUNDRED,
    )
  ) {
    return homey.__('settings.errorLog.errorCount.234')
  }
  return homey.__('settings.errorLog.errorCount.plural')
}

const updateErrorLogElements = (
  homey: Homey,
  { errors, fromDateHuman, nextFromDate, nextToDate }: ErrorLog,
): void => {
  errorCount += errors.length
  from = fromDateHuman
  to = nextToDate
  errorCountLabelElement.innerText = `${String(errorCount)} ${getErrorCountText(homey, errorCount)}`
  periodLabelElement.innerText = homey.__('settings.errorLog.period', { from })
  sinceElement.value = nextFromDate
}

const fetchErrorLog = async (homey: Homey): Promise<void> =>
  withDisablingButton(
    seeElement.id,
    async () =>
      new Promise((resolve) => {
        homey.api(
          'GET',
          `/logs/errors?${new URLSearchParams({
            from: sinceElement.value,
            limit: '29',
            offset: '0',
            to,
          } satisfies ErrorLogQuery)}`,
          async (error: Error | null, data: ErrorLog) => {
            if (error) {
              await homey.alert(error.message)
            } else {
              updateErrorLogElements(homey, data)
              generateErrorLogTableData(homey, data.errors)
            }
            resolve()
          },
        )
      }),
  )

const updateZoneMapping = (data: Partial<ZoneSettings>): void => {
  const { value } = zoneElement
  zoneMapping[value] = { ...zoneMapping[value], ...data }
}

const refreshHolidayModeData = (): void => {
  const { [zoneElement.value]: data } = zoneMapping
  if (data) {
    const {
      HMEnabled: isEnabled = false,
      HMEndDate: endDate,
      HMStartDate: startDate,
    } = data
    holidayModeEnabledElement.value = String(isEnabled)
    holidayModeStartDateElement.value = isEnabled ? (startDate ?? '') : ''
    holidayModeEndDateElement.value = isEnabled ? (endDate ?? '') : ''
  }
}

const refreshFrostProtectionData = (): void => {
  const { [zoneElement.value]: data } = zoneMapping
  if (data) {
    const {
      FPEnabled: isEnabled,
      FPMaxTemperature: max,
      FPMinTemperature: min,
    } = data
    frostProtectionEnabledElement.value = String(isEnabled)
    frostProtectionMinTemperatureElement.value = String(min)
    frostProtectionMaxTemperatureElement.value = String(max)
  }
}

const fetchHolidayModeData = async (homey: Homey): Promise<void> =>
  withDisablingButtons(
    'holiday_mode',
    async () =>
      new Promise((resolve) => {
        homey.api(
          'GET',
          `/settings/holiday_mode/${getZonePath()}`,
          (error: Error | null, data: HolidayModeData) => {
            if (!error) {
              updateZoneMapping(data)
              refreshHolidayModeData()
            }
            resolve()
          },
        )
      }),
  )

const fetchFrostProtectionData = async (homey: Homey): Promise<void> =>
  withDisablingButtons(
    'frost_protection',
    async () =>
      new Promise((resolve) => {
        homey.api(
          'GET',
          `/settings/frost_protection/${getZonePath()}`,
          (error: Error | null, data: FrostProtectionData) => {
            if (!error) {
              updateZoneMapping(data)
              refreshFrostProtectionData()
            }
            resolve()
          },
        )
      }),
  )

const generateZones = async (zones: Zone[]): Promise<void> =>
  zones.reduce(async (acc, zone) => {
    await acc
    const { id, level, model, name } = zone
    createOptionElement(zoneElement, {
      id: getZoneId(id, model),
      label: getZoneName(name, level),
    })
    if ('devices' in zone && zone.devices) {
      await generateZones(zone.devices)
    }
    if ('areas' in zone && zone.areas) {
      await generateZones(zone.areas)
    }
    if ('floors' in zone && zone.floors) {
      await generateZones(zone.floors)
    }
  }, Promise.resolve())

const fetchZoneSettings = async (homey: Homey): Promise<void> => {
  await fetchFrostProtectionData(homey)
  await fetchHolidayModeData(homey)
}

const fetchBuildings = async (homey: Homey): Promise<void> =>
  new Promise((resolve, reject) => {
    homey.api(
      'GET',
      '/buildings',
      async (error: Error | null, buildings: BuildingZone[]) => {
        if (error || !buildings.length) {
          if (error) {
            await homey.alert(error.message)
          }
          reject(error ?? new NoDeviceError(homey))
          return
        }
        await generateZones(buildings)
        await fetchErrorLog(homey)
        await fetchZoneSettings(homey)
        resolve()
      },
    )
  })

const needsAuthentication = (value = true): void => {
  hide(authenticatedElement, value)
  unhide(authenticatingElement, value)
}

const loadPostLogin = async (homey: Homey): Promise<void> => {
  try {
    await fetchBuildings(homey)
  } catch (error) {
    if (error instanceof NoDeviceError) {
      disableSettingButtons()
      await homey.alert(error.message)
    }
  } finally {
    needsAuthentication(false)
  }
}

const login = async (homey: Homey): Promise<void> => {
  const username = usernameElement?.value ?? ''
  const password = passwordElement?.value ?? ''
  if (!username || !password) {
    homey.alert(homey.__('settings.authenticate.failure')).catch(() => {
      //
    })
    return
  }
  await withDisablingButton(
    authenticateElement.id,
    async () =>
      new Promise((resolve) => {
        homey.api(
          'POST',
          '/sessions',
          { password, username } satisfies LoginCredentials,
          async (error: Error | null, loggedIn: boolean) => {
            if (error || !loggedIn) {
              await homey.alert(
                error ?
                  error.message
                : homey.__('settings.authenticate.failure'),
              )
            } else {
              await loadPostLogin(homey)
            }
            resolve()
          },
        )
      }),
  )
}

const setHolidayModeData = async (
  homey: Homey,
  { from: startDate, to: endDate }: HolidayModeQuery,
): Promise<void> =>
  withDisablingButtons(
    'holiday_mode',
    async () =>
      new Promise((resolve) => {
        homey.api(
          'PUT',
          `/settings/holiday_mode/${zoneElement.value.replace('_', '/')}`,
          { from: startDate, to: endDate } satisfies HolidayModeQuery,
          async (error: Error | null) => {
            if (!error) {
              updateZoneMapping({
                HMEnabled: Boolean(endDate),
                HMEndDate: endDate,
                HMStartDate: startDate,
              })
              refreshHolidayModeData()
            }
            await homey.alert(
              error ? error.message : homey.__('settings.success'),
            )
            resolve()
          },
        )
      }),
  )

const addUpdateHolidayModeEventListener = (homey: Homey): void => {
  updateHolidayModeElement.addEventListener('click', () => {
    const isEnabled = holidayModeEnabledElement.value === 'true'
    const endDate = holidayModeEndDateElement.value || undefined
    if (isEnabled && endDate === undefined) {
      homey.alert(homey.__('settings.holidayMode.endDateMissing')).catch(() => {
        //
      })
      return
    }
    setHolidayModeData(homey, {
      from: holidayModeStartDateElement.value || undefined,
      to: endDate,
    }).catch(() => {
      //
    })
  })
}

const addHolidayModeEventListeners = (homey: Homey): void => {
  holidayModeEnabledElement.addEventListener('change', () => {
    if (holidayModeEnabledElement.value === 'false') {
      holidayModeStartDateElement.value = ''
      holidayModeEndDateElement.value = ''
    }
  })
  holidayModeStartDateElement.addEventListener('change', () => {
    if (holidayModeStartDateElement.value) {
      if (holidayModeEnabledElement.value === 'false') {
        holidayModeEnabledElement.value = 'true'
      }
    } else if (
      !holidayModeEndDateElement.value &&
      holidayModeEnabledElement.value === 'true'
    ) {
      holidayModeEnabledElement.value = 'false'
    }
  })
  holidayModeEndDateElement.addEventListener('change', () => {
    if (holidayModeEndDateElement.value) {
      if (holidayModeEnabledElement.value === 'false') {
        holidayModeEnabledElement.value = 'true'
      }
    } else if (
      !holidayModeStartDateElement.value &&
      holidayModeEnabledElement.value === 'true'
    ) {
      holidayModeEnabledElement.value = 'false'
    }
  })
  refreshHolidayModeElement.addEventListener('click', () => {
    refreshHolidayModeData()
  })
  addUpdateHolidayModeEventListener(homey)
}

const getFPMinAndMax = (homey: Homey): { max: number; min: number } => {
  const errors: string[] = []
  let [min, max] = [
    frostProtectionMinTemperatureElement,
    frostProtectionMaxTemperatureElement,
  ].map((element) => {
    try {
      return int(homey, element)
    } catch (error) {
      errors.push(getErrorMessage(error))
      return Number(element.value)
    }
  })
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
  if (max < min) {
    ;[min, max] = [max, min]
  }
  return { max: Math.max(max, min + FROST_PROTECTION_TEMPERATURE_GAP), min }
}

const setFrostProtectionData = async (
  homey: Homey,
  { enabled, max, min }: FrostProtectionQuery,
): Promise<void> =>
  withDisablingButtons(
    'frost_protection',
    async () =>
      new Promise((resolve) => {
        homey.api(
          'PUT',
          `/settings/frost_protection/${getZonePath()}`,
          { enabled, max, min } satisfies FrostProtectionQuery,
          async (error: Error | null) => {
            if (!error) {
              updateZoneMapping({
                FPEnabled: enabled,
                FPMaxTemperature: max,
                FPMinTemperature: min,
              })
              refreshFrostProtectionData()
            }
            await homey.alert(
              error ? error.message : homey.__('settings.success'),
            )
            resolve()
          },
        )
      }),
  )

const addFrostProtectionEventListeners = (homey: Homey): void => {
  ;[
    frostProtectionMinTemperatureElement,
    frostProtectionMaxTemperatureElement,
  ].forEach((element) => {
    element.addEventListener('change', () => {
      if (element.value === 'false') {
        element.value = 'true'
      }
    })
  })
  refreshFrostProtectionElement.addEventListener('click', () => {
    refreshFrostProtectionData()
  })
  updateFrostProtectionElement.addEventListener('click', () => {
    try {
      const { max, min } = getFPMinAndMax(homey)
      setFrostProtectionData(homey, {
        enabled: frostProtectionEnabledElement.value === 'true',
        max,
        min,
      }).catch(() => {
        //
      })
    } catch (error) {
      homey.alert(getErrorMessage(error)).catch(() => {
        //
      })
    }
  })
}

const addEventListeners = (homey: Homey): void => {
  authenticateElement.addEventListener('click', () => {
    login(homey).catch(() => {
      //
    })
  })
  sinceElement.addEventListener('change', () => {
    if (
      to &&
      sinceElement.value &&
      Date.parse(sinceElement.value) > Date.parse(to)
    ) {
      sinceElement.value = to
      homey.alert(homey.__('settings.errorLog.error', { from })).catch(() => {
        //
      })
    }
  })
  seeElement.addEventListener('click', () => {
    fetchErrorLog(homey).catch(() => {
      //
    })
  })
  autoAdjustElement.addEventListener('click', () => {
    homey.openURL('https://homey.app/a/com.mecloud.extension').catch(() => {
      //
    })
  })
  zoneElement.addEventListener('change', () => {
    fetchZoneSettings(homey).catch(() => {
      //
    })
  })
  addHolidayModeEventListeners(homey)
  addFrostProtectionEventListeners(homey)
}

const load = async (
  homey: Homey,
  contextKey?: string | null,
): Promise<void> => {
  if (contextKey !== undefined) {
    try {
      await fetchBuildings(homey)
      return
    } catch {}
  }
  needsAuthentication()
}

// eslint-disable-next-line func-style
async function onHomeyReady(homey: Homey): Promise<void> {
  const homeySettings = await fetchHomeySettings(homey)
  await setDocumentLanguage(homey)
  await fetchDeviceSettings(homey)
  await fetchDriverSettings(homey, {
    password: homeySettings.password,
    username: homeySettings.username,
  })
  addEventListeners(homey)
  await load(homey, homeySettings.contextKey)
  homey.ready()
}
