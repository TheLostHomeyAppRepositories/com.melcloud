/* eslint-disable @typescript-eslint/no-unsafe-call, max-lines */
import type {
  Building,
  BuildingData,
  FrostProtectionData,
  HolidayModeData,
  LoginCredentials,
} from '../melcloud/types'
import type {
  DeviceSetting,
  DeviceSettings,
  DriverSetting,
  ErrorDetails,
  ErrorLog,
  ErrorLogQuery,
  FrostProtectionSettings,
  HolidayModeSettings,
  HomeySettingsUI,
  LoginDriverSetting,
  Settings,
  ValueOf,
} from '../types'
import type Homey from 'homey/lib/Homey'

const DIVISOR_10 = 10
const DIVISOR_100 = 100
const FP_MIN_MAX_GAP = 2

const NUMBER_1 = 1
const NUMBER_2 = 2
const NUMBER_3 = 3
const NUMBER_4 = 4
const NUMBER_12 = 12
const NUMBER_13 = 13
const NUMBER_14 = 14

let homeySettings: HomeySettingsUI = {
  contextKey: '',
  expiry: '',
  password: '',
  username: '',
}
let deviceSettings: DeviceSettings = {}
let flatDeviceSettings: DeviceSetting = {}
let driverSettingsAll: DriverSetting[] = []
let driverSettingsCommon: DriverSetting[] = []
let driverSettingsDrivers: Record<string, DriverSetting[]> = {}
let usernameElement: HTMLInputElement | null = null
let passwordElement: HTMLInputElement | null = null

const minMinTemperature = 4
const maxMinTemperature = 14
const minMaxTemperature = 6
const maxMaxTemperature = 16

const authenticateElement = document.getElementById(
  'authenticate',
) as HTMLButtonElement
const autoAdjustElement = document.getElementById(
  'auto_adjust',
) as HTMLButtonElement
const refreshFrostProtectionElement = document.getElementById(
  'refresh-frost-protection',
) as HTMLButtonElement
const refreshHolidayModeElement = document.getElementById(
  'refresh-holiday-mode',
) as HTMLButtonElement
const seeElement = document.getElementById('see') as HTMLButtonElement
const updateFrostProtectionElement = document.getElementById(
  'apply-frost-protection',
) as HTMLButtonElement
const updateHolidayModeElement = document.getElementById(
  'apply-holiday-mode',
) as HTMLButtonElement

const authenticatedElement = document.getElementById(
  'authenticated',
) as HTMLDivElement
const authenticatingElement = document.getElementById(
  'authenticating',
) as HTMLDivElement
const errorLogElement = document.getElementById('error-log') as HTMLDivElement
const loginElement = document.getElementById('login') as HTMLDivElement
const settingsCommonElement = document.getElementById(
  'settings-common',
) as HTMLDivElement

const sinceElement = document.getElementById('since') as HTMLInputElement
const frostProtectionMinTemperatureElement = document.getElementById(
  'min',
) as HTMLInputElement
frostProtectionMinTemperatureElement.min = String(minMinTemperature)
frostProtectionMinTemperatureElement.max = String(maxMinTemperature)
const frostProtectionMaxTemperatureElement = document.getElementById(
  'max',
) as HTMLInputElement
frostProtectionMaxTemperatureElement.min = String(minMaxTemperature)
frostProtectionMaxTemperatureElement.max = String(maxMaxTemperature)
const holidayModeStartDateElement = document.getElementById(
  'start-date',
) as HTMLInputElement
const holidayModeEndDateElement = document.getElementById(
  'end-date',
) as HTMLInputElement

const errorCountLabelElement = document.getElementById(
  'error_count',
) as HTMLLabelElement
const periodLabelElement = document.getElementById('period') as HTMLLabelElement

const buildingElement = document.getElementById(
  'buildings',
) as HTMLSelectElement
const frostProtectionEnabledElement = document.getElementById(
  'enabled-frost-protection',
) as HTMLSelectElement
const holidayModeEnabledElement = document.getElementById(
  'enabled-holiday-mode',
) as HTMLSelectElement

let buildingMapping: Record<string, BuildingData> = {}

let errorLogTBodyElement: HTMLTableSectionElement | null = null

let errorCount = 0
let fromDateHuman = ''
let to = ''

const disableButton = (elementId: string, value = true): void => {
  const element = document.getElementById(elementId)
  if (element) {
    if (value) {
      element.classList.add('is-disabled')
      return
    }
    element.classList.remove('is-disabled')
  }
}

const disableButtons = (setting: string, value = true): void => {
  const [baseSetting, suffix] = setting.split('-')
  ;['apply', 'refresh'].forEach((action) => {
    disableButton(`${action}-${setting}`, value)
    if (suffix === 'common') {
      Object.keys(deviceSettings).forEach((driverId) => {
        disableButton(`${action}-${baseSetting}-${driverId}`, value)
      })
      return
    }
    disableButton(`${action}-${baseSetting}-common`, value)
  })
}

const enableButtons = (setting: string, value = true): void => {
  disableButtons(setting, !value)
}

const hide = (element: HTMLDivElement, value = true): void => {
  element.classList.toggle('hidden', value)
}

const unhide = (element: HTMLDivElement, value = true): void => {
  hide(element, !value)
}

const setDocumentLanguage = async (homey: Homey): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api('GET', '/language', (error: Error | null, language: string) => {
      if (error) {
        reject(error)
        return
      }
      document.documentElement.lang = language
      resolve()
    })
  })

const getHomeySettings = async (homey: Homey): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.get(async (error: Error | null, settings: HomeySettingsUI) => {
      if (error) {
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(error.message)
        reject(error)
        return
      }
      homeySettings = settings
      resolve()
    })
  })

const getDeviceSettings = async (homey: Homey): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'GET',
      '/settings/devices',
      async (error: Error | null, settings: DeviceSettings) => {
        if (error) {
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(error.message)
          reject(error)
          return
        }
        deviceSettings = settings
        resolve()
      },
    )
  })

const getFlatDeviceSettings = (): void => {
  flatDeviceSettings = Object.values(deviceSettings).reduce<DeviceSetting>(
    (flattenedDeviceSettings, settings) =>
      Object.entries(settings).reduce<DeviceSetting>(
        (acc, [settingId, settingValues]) => {
          if (!(settingId in acc)) {
            acc[settingId] = []
          }
          const values = new Set<ValueOf<Settings>>([
            ...acc[settingId],
            ...settingValues,
          ])
          acc[settingId] = Array.from(values)
          return acc
        },
        flattenedDeviceSettings,
      ),
    {},
  )
}

const getDriverSettingsAll = async (homey: Homey): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'GET',
      '/settings/drivers',
      async (error: Error | null, driverSettings: DriverSetting[]) => {
        if (error) {
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(error.message)
          reject(error)
          return
        }
        driverSettingsAll = driverSettings
        resolve()
      },
    )
  })

const getDriverSettings = (): void => {
  ;({ driverSettingsCommon, driverSettingsDrivers } = driverSettingsAll.reduce<{
    driverSettingsCommon: DriverSetting[]
    driverSettingsDrivers: Record<string, DriverSetting[]>
  }>(
    (acc, setting) => {
      if (setting.groupId === 'login') {
        return acc
      }
      if (setting.groupId === 'options') {
        if (
          !acc.driverSettingsCommon.some((option) => option.id === setting.id)
        ) {
          acc.driverSettingsCommon.push(setting)
        }
      } else {
        const { driverId } = setting
        if (!(driverId in acc.driverSettingsDrivers)) {
          acc.driverSettingsDrivers[driverId] = []
        }
        acc.driverSettingsDrivers[driverId].push(setting)
      }
      return acc
    },
    { driverSettingsCommon: [], driverSettingsDrivers: {} },
  ))
}

const createDivElement = (): HTMLDivElement => {
  const divElement = document.createElement('div')
  divElement.classList.add('homey-form-group')
  return divElement
}

const createInputElement = ({
  placeholder,
  value,
  id,
  type,
}: {
  placeholder?: string
  value?: string
  id: string
  type: string
}): HTMLInputElement => {
  const inputElement = document.createElement('input')
  inputElement.classList.add('homey-form-input')
  inputElement.id = id
  inputElement.value = value ?? ''
  inputElement.type = type
  if (typeof placeholder !== 'undefined') {
    inputElement.placeholder = placeholder
  }
  return inputElement
}

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
  labelElement.appendChild(checkboxElement)
  labelElement.appendChild(checkmarkSpanElement)
  labelElement.appendChild(textSpanElement)
}

const createLabelElement = (
  element: HTMLInputElement | HTMLSelectElement,
  { text }: { text: string },
): HTMLLabelElement => {
  const isCheckbox = element.type === 'checkbox'
  const labelElement = document.createElement('label')
  labelElement.classList.add(
    isCheckbox ? 'homey-form-checkbox' : 'homey-form-label',
  )
  labelElement.htmlFor = element.id
  if (isCheckbox) {
    addTextToCheckbox(labelElement, element as HTMLInputElement, text)
  } else {
    labelElement.innerText = text
  }
  return labelElement
}

const updateCredentialElement = (
  credentialKey: keyof LoginCredentials,
): HTMLInputElement | null => {
  const driverSetting = driverSettingsAll.find(
    (setting): setting is LoginDriverSetting => setting.id === credentialKey,
  )
  if (driverSetting) {
    const divElement = createDivElement()
    const inputElement = createInputElement({
      id: driverSetting.id,
      placeholder: driverSetting.placeholder,
      type: driverSetting.type,
      value: homeySettings[driverSetting.id],
    })
    const labelElement = createLabelElement(inputElement, {
      text: driverSetting.title,
    })
    divElement.appendChild(labelElement)
    divElement.appendChild(inputElement)
    loginElement.appendChild(divElement)
    return inputElement
  }
  return null
}

const updateCredentialElements = (): void => {
  ;[usernameElement, passwordElement] = (
    ['username', 'password'] satisfies (keyof LoginCredentials)[]
  ).map(updateCredentialElement)
}

const int = (homey: Homey, element: HTMLInputElement): number => {
  const value = Number.parseInt(element.value, 10)
  if (
    Number.isNaN(value) ||
    value < Number(element.min) ||
    value > Number(element.max)
  ) {
    element.value = ''
    const labelElement: HTMLLabelElement | null = document.querySelector(
      `label[for="${element.id}"]`,
    )
    throw new Error(
      homey.__('settings.int_error', {
        max: element.max,
        min: element.min,
        name: homey.__(labelElement?.innerText ?? ''),
      }),
    )
  }
  return value
}

const processSettingValue = (
  element: HTMLInputElement | HTMLSelectElement,
): ValueOf<Settings> => {
  if (element.value) {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      if (element.indeterminate) {
        return null
      }
      return element.checked
    }
    return ['true', 'false'].includes(element.value) ?
        element.value === 'true'
      : element.value
  }
  return null
}

const shouldUpdate = (
  settingId: string,
  settingValue: ValueOf<Settings>,
  driverId?: string,
): boolean => {
  if (settingValue === null) {
    return false
  }
  const deviceSetting =
    typeof driverId === 'undefined' ?
      flatDeviceSettings[settingId]
    : (deviceSettings[driverId] as DeviceSetting | undefined)?.[settingId]
  if (typeof deviceSetting === 'undefined') {
    return false
  }
  if (new Set(deviceSetting).size !== NUMBER_1) {
    return true
  }
  const [deviceSettingValue] = deviceSetting
  return settingValue !== deviceSettingValue
}

const buildSettingsBody = (
  homey: Homey,
  elements: (HTMLInputElement | HTMLSelectElement)[],
  driverId?: string,
): Settings =>
  Object.fromEntries(
    elements
      .map((element) => {
        const [settingId] = element.id.split('--')
        const settingValue = processSettingValue(element)
        return shouldUpdate(settingId, settingValue, driverId) ?
            [settingId, settingValue]
          : [null]
      })
      .filter((entry): entry is [string, ValueOf<Settings>] => {
        const [key] = entry
        return key !== null
      }),
  )

const generateErrorLogTable = (
  homey: Homey,
  keys: string[],
): HTMLTableSectionElement => {
  const tableElement = document.createElement('table')
  tableElement.classList.add('bordered')
  tableElement.setAttribute('aria-describedby', 'Error Log')
  const theadElement = tableElement.createTHead()
  const rowElement = theadElement.insertRow()
  keys.forEach((key) => {
    const thElement = document.createElement('th')
    thElement.innerText = homey.__(`settings.error_log.columns.${key}`)
    rowElement.appendChild(thElement)
  })
  errorLogElement.appendChild(tableElement)
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
  switch (true) {
    case count < NUMBER_2:
      return homey.__(`settings.error_log.error_count.${String(count)}`)
    case [NUMBER_2, NUMBER_3, NUMBER_4].includes(count % DIVISOR_10) &&
      ![NUMBER_12, NUMBER_13, NUMBER_14].includes(count % DIVISOR_100):
      return homey.__('settings.error_log.error_count.234')
    default:
      return homey.__('settings.error_log.error_count.plural')
  }
}

const updateErrorLogElements = (homey: Homey, data: ErrorLog): void => {
  ;({ fromDateHuman } = data)
  periodLabelElement.innerText = homey.__('settings.error_log.period', {
    fromDateHuman,
  })
  sinceElement.value = data.nextFromDate
  to = data.nextToDate
  errorCount += data.errors.length
  errorCountLabelElement.innerText = `${String(errorCount)} ${getErrorCountText(homey, errorCount)}`
}

const generateErrorLog = (homey: Homey): void => {
  const query: ErrorLogQuery = {
    from: sinceElement.value,
    limit: '29',
    offset: '0',
    to,
  }
  const queryString = new URLSearchParams(
    query as Record<string, string>,
  ).toString()
  // @ts-expect-error: `homey` is partially typed
  homey.api(
    'GET',
    `/errors?${queryString}`,
    async (error: Error | null, data: ErrorLog) => {
      seeElement.classList.remove('is-disabled')
      if (error) {
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(error.message)
        return
      }
      updateErrorLogElements(homey, data)
      generateErrorLogTableData(homey, data.errors)
    },
  )
}

const refreshBuildingHolidayModeSettings = (data: HolidayModeData): void => {
  const {
    HMEnabled: enabled,
    HMEndDate: endDate,
    HMStartDate: startDate,
  } = data
  holidayModeEnabledElement.value = String(enabled)
  holidayModeEndDateElement.value = enabled ? endDate ?? '' : ''
  holidayModeStartDateElement.value = enabled ? startDate ?? '' : ''
}

const refreshBuildingFrostProtectionSettings = (
  data: FrostProtectionData,
): void => {
  const {
    FPEnabled: enabled,
    FPMaxTemperature: max,
    FPMinTemperature: min,
  } = data
  frostProtectionEnabledElement.value = String(enabled)
  frostProtectionMaxTemperatureElement.value = String(max)
  frostProtectionMinTemperatureElement.value = String(min)
}

const refreshBuildingSettings = (): void => {
  const settings = buildingMapping[buildingElement.value]
  refreshBuildingHolidayModeSettings(settings)
  refreshBuildingFrostProtectionSettings(settings)
}

const updateBuildingMapping = (
  data: FrostProtectionData | HolidayModeData,
): void => {
  buildingMapping[buildingElement.value] = {
    ...buildingMapping[buildingElement.value],
    ...data,
  }
}

const getBuildingHolidayModeSettings = async (
  homey: Homey,
  raise = false,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'GET',
      `/settings/buildings/${buildingElement.value}/holiday_mode`,
      async (error: Error | null, data: HolidayModeData) => {
        enableButtons('holiday-mode')
        if (error) {
          if (raise) {
            reject(new Error(error.message))
          } else {
            // @ts-expect-error: `homey` is partially typed
            await homey.alert(error.message)
            resolve()
          }
          return
        }
        updateBuildingMapping(data)
        refreshBuildingHolidayModeSettings(data)
        resolve()
      },
    )
  })

const getBuildingFrostProtectionSettings = async (
  homey: Homey,
  raise = false,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'GET',
      `/settings/buildings/${buildingElement.value}/frost_protection`,
      async (error: Error | null, data: FrostProtectionData) => {
        enableButtons('frost-protection')
        if (error) {
          if (raise) {
            reject(new Error(error.message))
          } else {
            // @ts-expect-error: `homey` is partially typed
            await homey.alert(error.message)
            resolve()
          }
          return
        }
        updateBuildingMapping(data)
        refreshBuildingFrostProtectionSettings(data)
        resolve()
      },
    )
  })

const getBuildings = async (
  homey: Homey,
): Promise<Record<string, BuildingData>> =>
  new Promise<Record<string, BuildingData>>((resolve, reject) => {
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'GET',
      '/buildings',
      async (error: Error | null, buildings: Building[]) => {
        if (error) {
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(error.message)
          reject(error)
          return
        }
        buildingMapping = Object.fromEntries(
          buildings.map((building) => {
            const {
              ID,
              Name: name,
              FPEnabled: fpEnabled,
              FPMaxTemperature: fpMax,
              FPMinTemperature: fpMin,
              HMEnabled: hmEnabled,
              HMEndDate: hmEndDate,
              HMStartDate: hmStartDate,
            } = building
            const optionElement = document.createElement('option')
            optionElement.value = String(ID)
            optionElement.innerText = name
            buildingElement.appendChild(optionElement)
            return [
              String(ID),
              {
                FPEnabled: fpEnabled,
                FPMaxTemperature: fpMax,
                FPMinTemperature: fpMin,
                HMEnabled: hmEnabled,
                HMEndDate: hmEndDate,
                HMStartDate: hmStartDate,
              },
            ]
          }),
        )
        resolve(buildingMapping)
      },
    )
  })

const updateDeviceSettings = (body: Settings, driverId?: string): void => {
  if (typeof driverId === 'undefined') {
    Object.entries(body).forEach(([settingId, settingValue]) => {
      Object.keys(deviceSettings).forEach((driver) => {
        deviceSettings[driver][settingId] = [settingValue]
      })
      flatDeviceSettings[settingId] = [settingValue]
    })
    return
  }
  Object.entries(body).forEach(([settingId, settingValue]) => {
    deviceSettings[driverId][settingId] = [settingValue]
  })
  getFlatDeviceSettings()
}

const setDeviceSettings = (
  homey: Homey,
  body: Settings,
  driverId?: string,
): void => {
  let endPoint = '/settings/devices'
  if (typeof driverId !== 'undefined') {
    const queryString = new URLSearchParams({ driverId }).toString()
    endPoint += `?${queryString}`
  }
  // @ts-expect-error: `homey` is partially typed
  homey.api('PUT', endPoint, body, async (error: Error | null) => {
    if (error) {
      // @ts-expect-error: `homey` is partially typed
      await homey.alert(error.message)
      return
    }
    updateDeviceSettings(body, driverId)
    enableButtons(`settings-${driverId ?? 'common'}`)
    // @ts-expect-error: `homey` is partially typed
    await homey.alert(homey.__('settings.success'))
  })
}

const addApplySettingsEventListener = (
  homey: Homey,
  elements: (HTMLInputElement | HTMLSelectElement)[],
  driverId?: string,
): void => {
  const settings = `settings-${driverId ?? 'common'}`
  const buttonElement = document.getElementById(
    `apply-${settings}`,
  ) as HTMLButtonElement
  buttonElement.addEventListener('click', () => {
    const body = buildSettingsBody(homey, elements, driverId)
    if (!Object.keys(body).length) {
      // @ts-expect-error: `homey` is partially typed
      homey.alert(homey.__('settings.devices.apply.nothing'))
      return
    }
    // @ts-expect-error: `homey` is partially typed
    homey.confirm(
      homey.__('settings.devices.apply.confirm'),
      null,
      async (error: Error | null, ok: boolean) => {
        if (error) {
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(error.message)
          return
        }
        if (ok) {
          disableButtons(settings)
          setDeviceSettings(homey, body, driverId)
        }
      },
    )
  })
}

const updateCommonChildrenElement = (element: HTMLSelectElement): void => {
  const [settingId] = element.id.split('--')
  const values = flatDeviceSettings[settingId] as
    | ValueOf<Settings>[]
    | undefined
  if (values && new Set(values).size === NUMBER_1) {
    const [value] = values
    element.value = String(value)
    return
  }
  element.value = ''
}

const addRefreshSettingsCommonEventListener = (
  elements: HTMLSelectElement[],
): void => {
  elements.forEach(updateCommonChildrenElement)
}

const updateCheckboxChildrenElement = (
  element: HTMLInputElement,
  driverId: string,
): void => {
  const [settingId] = element.id.split('--')
  const values = deviceSettings[driverId][settingId] as boolean[]
  if (new Set(values).size === NUMBER_1) {
    ;[element.checked] = values
    return
  }
  element.indeterminate = true
  element.addEventListener('change', () => {
    if (element.indeterminate) {
      element.indeterminate = false
    }
  })
}

const addRefreshSettingsDriverEventListener = (
  elements: HTMLInputElement[],
  driverId: string,
): void => {
  elements.forEach((element) => {
    updateCheckboxChildrenElement(element, driverId)
  })
}

const addRefreshSettingsEventListener = (
  elements: (HTMLInputElement | HTMLSelectElement)[],
  driverId?: string,
): void => {
  const settings = `settings-${driverId ?? 'common'}`
  const buttonElement = document.getElementById(
    `refresh-${settings}`,
  ) as HTMLButtonElement
  buttonElement.addEventListener('click', () => {
    disableButtons(settings)
    if (typeof driverId === 'undefined') {
      addRefreshSettingsCommonEventListener(elements as HTMLSelectElement[])
    } else {
      addRefreshSettingsDriverEventListener(
        elements as HTMLInputElement[],
        driverId,
      )
    }
    enableButtons(settings)
  })
}

const addSettingsEventListeners = (
  homey: Homey,
  elements: (HTMLInputElement | HTMLSelectElement)[],
  driverId?: string,
): void => {
  addApplySettingsEventListener(homey, elements, driverId)
  addRefreshSettingsEventListener(elements, driverId)
}

const createSelectElement = (
  homey: Homey,
  setting: DriverSetting,
): HTMLSelectElement => {
  const selectElement = document.createElement('select')
  selectElement.classList.add('homey-form-select')
  selectElement.id = `${setting.id}--setting`
  ;[
    { id: '' },
    ...(setting.type === 'checkbox' ?
      ['false', 'true'].map((id) => ({
        id,
        label: homey.__(`settings.boolean.${id}`),
      }))
    : setting.values ?? []),
  ].forEach(({ id, label }: { label?: string; id: string }) => {
    const optionElement = document.createElement('option')
    optionElement.value = id
    if (typeof label !== 'undefined') {
      optionElement.innerText = label
    }
    selectElement.appendChild(optionElement)
  })
  updateCommonChildrenElement(selectElement)
  return selectElement
}

const generateCommonChildrenElements = (homey: Homey): void => {
  driverSettingsCommon.forEach((setting) => {
    if (['checkbox', 'dropdown'].includes(setting.type)) {
      const divElement = createDivElement()
      const selectElement = createSelectElement(homey, setting)
      const labelElement = createLabelElement(selectElement, {
        text: setting.title,
      })
      divElement.appendChild(labelElement)
      divElement.appendChild(selectElement)
      settingsCommonElement.appendChild(divElement)
    }
  })
  addSettingsEventListeners(
    homey,
    Array.from(settingsCommonElement.querySelectorAll('select')),
  )
}

const createLegendElement = ({
  text,
}: {
  text?: string
}): HTMLLegendElement => {
  const legendElement = document.createElement('legend')
  legendElement.classList.add('homey-form-checkbox-set-title')
  if (typeof text !== 'undefined') {
    legendElement.innerText = text
  }
  return legendElement
}

const createCheckboxElement = (
  { id }: { id: string },
  driverId: string,
): HTMLInputElement => {
  const checkboxElement = document.createElement('input')
  checkboxElement.classList.add('homey-form-checkbox-input')
  checkboxElement.type = 'checkbox'
  checkboxElement.id = `${id}--settings-${driverId}`
  updateCheckboxChildrenElement(checkboxElement, driverId)
  return checkboxElement
}

const generateCheckboxChildrenElements = (
  homey: Homey,
  driverId: string,
): void => {
  const settingsElement = document.getElementById(
    `settings-${driverId}`,
  ) as HTMLDivElement | null
  if (settingsElement) {
    const fieldSetElement = document.createElement('fieldset')
    fieldSetElement.classList.add('homey-form-checkbox-set')
    let previousGroupLabel: string | undefined = ''
    driverSettingsDrivers[driverId].forEach((setting) => {
      if (setting.type === 'checkbox') {
        if (setting.groupLabel !== previousGroupLabel) {
          previousGroupLabel = setting.groupLabel
          const legendElement = createLegendElement({
            text: setting.groupLabel,
          })
          fieldSetElement.appendChild(legendElement)
        }
        const checkboxElement = createCheckboxElement(
          { id: setting.id },
          driverId,
        )
        const labelElement = createLabelElement(checkboxElement, {
          text: setting.title,
        })
        fieldSetElement.appendChild(labelElement)
      }
    })
    settingsElement.appendChild(fieldSetElement)
    addSettingsEventListeners(
      homey,
      Array.from(fieldSetElement.querySelectorAll('input')),
      driverId,
    )
    unhide(document.getElementById(`has-devices-${driverId}`) as HTMLDivElement)
  }
}

const generate = async (homey: Homey): Promise<void> => {
  buildingMapping = await getBuildings(homey)
  if (!Object.keys(buildingMapping).length) {
    seeElement.classList.add('is-disabled')
    disableButtons('frost-protection')
    disableButtons('holiday-mode')
    disableButtons('settings-common')
    // @ts-expect-error: `homey` is partially typed
    await homey.alert(homey.__('settings.devices.none'))
    return
  }
  refreshBuildingSettings()
  generateErrorLog(homey)
}

const needsAuthentication = (value = true): void => {
  if (!loginElement.childElementCount) {
    updateCredentialElements()
  }
  hide(authenticatedElement, value)
  unhide(authenticatingElement, value)
}

const login = async (homey: Homey): Promise<void> => {
  const username = usernameElement?.value ?? ''
  const password = passwordElement?.value ?? ''
  if (!username || !password) {
    // @ts-expect-error: `homey` is partially typed
    await homey.alert(homey.__('settings.authenticate.failure'))
    return
  }
  const body: LoginCredentials = { password, username }
  // @ts-expect-error: `homey` is partially typed
  homey.api(
    'POST',
    '/sessions',
    body,
    async (error: Error | null, loggedIn: boolean) => {
      if (error) {
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(error.message)
        return
      }
      if (!loggedIn) {
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(homey.__('settings.authenticate.failure'))
        return
      }
      await generate(homey)
      needsAuthentication(false)
    },
  )
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
    disableButtons('holiday-mode')
    getBuildingHolidayModeSettings(homey).catch(async (error: unknown) => {
      // @ts-expect-error: `homey` is partially typed
      await homey.alert(error instanceof Error ? error.message : String(error))
    })
  })
}

const addUpdateHolidayModeEventListener = (homey: Homey): void => {
  updateHolidayModeElement.addEventListener('click', () => {
    disableButtons('holiday-mode')
    const data = buildingMapping[buildingElement.value]
    const enabled = holidayModeEnabledElement.value === 'true'
    const body: HolidayModeSettings = {
      enabled,
      endDate: enabled ? holidayModeEndDateElement.value : '',
      startDate: enabled ? holidayModeStartDateElement.value : '',
    }
    // @ts-expect-error: `homey` is partially typed
    homey.api(
      'PUT',
      `/settings/buildings/${buildingElement.value}/holiday_mode`,
      body,
      async (error: Error | null) => {
        enableButtons('holiday-mode')
        try {
          await getBuildingHolidayModeSettings(homey, true)
          if (error) {
            // @ts-expect-error: `homey` is partially typed
            await homey.alert(error.message)
            return
          }
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(homey.__('settings.success'))
        } catch (err) {
          refreshBuildingHolidayModeSettings(data)
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(err.message)
        }
      },
    )
  })
}

const addFrostProtectionEventListeners = (homey: Homey): void => {
  frostProtectionMinTemperatureElement.addEventListener('change', () => {
    if (frostProtectionEnabledElement.value === 'false') {
      frostProtectionEnabledElement.value = 'true'
    }
  })

  frostProtectionMaxTemperatureElement.addEventListener('change', () => {
    if (frostProtectionEnabledElement.value === 'false') {
      frostProtectionEnabledElement.value = 'true'
    }
  })

  refreshFrostProtectionElement.addEventListener('click', () => {
    disableButtons('frost-protection')
    getBuildingFrostProtectionSettings(homey).catch(async (error: unknown) => {
      // @ts-expect-error: `homey` is partially typed
      await homey.alert(error instanceof Error ? error.message : String(error))
    })
  })
}

const updateFrostProtectionData = (
  homey: Homey,
  body: FrostProtectionSettings,
  data: FrostProtectionData,
): void => {
  // @ts-expect-error: `homey` is partially typed
  homey.api(
    'PUT',
    `/settings/buildings/${buildingElement.value}/frost_protection`,
    body,
    async (error: Error | null) => {
      enableButtons('frost-protection')
      try {
        await getBuildingFrostProtectionSettings(homey, true)
        if (error) {
          // @ts-expect-error: `homey` is partially typed
          await homey.alert(error.message)
          return
        }
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(homey.__('settings.success'))
      } catch (err) {
        refreshBuildingFrostProtectionSettings(data)
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(err.message)
      }
    },
  )
}

const fixAndGetFpMinMax = (homey: Homey): { max: number; min: number } => {
  let [min, max] = [
    int(homey, frostProtectionMinTemperatureElement),
    int(homey, frostProtectionMaxTemperatureElement),
  ]
  if (min > max) {
    ;[min, max] = [max, min]
  }
  if (max - min < FP_MIN_MAX_GAP) {
    max = min + FP_MIN_MAX_GAP
  }
  if (frostProtectionMinTemperatureElement.value !== String(min)) {
    frostProtectionMinTemperatureElement.value = String(min)
    frostProtectionMaxTemperatureElement.value = String(max)
  }
  return { max, min }
}

const addUpdateFrostProtectionEventListener = (homey: Homey): void => {
  updateFrostProtectionElement.addEventListener('click', () => {
    disableButtons('frost-protection')
    const data = buildingMapping[buildingElement.value]
    try {
      const { max, min } = fixAndGetFpMinMax(homey)
      updateFrostProtectionData(
        homey,
        {
          Enabled: frostProtectionEnabledElement.value === 'true',
          MaximumTemperature: max,
          MinimumTemperature: min,
        },
        data,
      )
    } catch (error) {
      refreshBuildingFrostProtectionSettings(data)
      enableButtons('frost-protection')
      // @ts-expect-error: `homey` is partially typed
      homey.alert(error instanceof Error ? error.message : String(error))
    }
  })
}

const addEventListeners = (homey: Homey): void => {
  authenticateElement.addEventListener('click', () => {
    authenticateElement.classList.add('is-disabled')
    login(homey)
      .catch(async (error: unknown) => {
        // @ts-expect-error: `homey` is partially typed
        await homey.alert(
          error instanceof Error ? error.message : String(error),
        )
      })
      .finally(() => {
        authenticateElement.classList.remove('is-disabled')
      })
  })

  sinceElement.addEventListener('change', () => {
    if (
      to &&
      sinceElement.value &&
      Date.parse(sinceElement.value) > Date.parse(to)
    ) {
      sinceElement.value = to
      // @ts-expect-error: `homey` is partially typed
      homey.alert(homey.__('settings.error_log.error', { fromDateHuman }))
    }
  })

  seeElement.addEventListener('click', () => {
    seeElement.classList.add('is-disabled')
    generateErrorLog(homey)
  })

  autoAdjustElement.addEventListener('click', () => {
    // @ts-expect-error: `homey` is partially typed
    homey.openURL('https://homey.app/a/com.mecloud.extension')
  })

  buildingElement.addEventListener('change', refreshBuildingSettings)

  addHolidayModeEventListeners(homey)
  addUpdateHolidayModeEventListener(homey)
  addFrostProtectionEventListeners(homey)
  addUpdateFrostProtectionEventListener(homey)
}

const load = async (homey: Homey): Promise<void> => {
  addEventListeners(homey)
  generateCommonChildrenElements(homey)
  if (typeof homeySettings.contextKey !== 'undefined') {
    Object.keys(deviceSettings).forEach((driverId) => {
      generateCheckboxChildrenElements(homey, driverId)
    })
    try {
      await generate(homey)
      return
    } catch (error) {
      // Skip
    }
  }
  needsAuthentication()
}

// eslint-disable-next-line func-style
async function onHomeyReady(homey: Homey): Promise<void> {
  await homey.ready()
  await setDocumentLanguage(homey)
  await getHomeySettings(homey)
  await getDeviceSettings(homey)
  getFlatDeviceSettings()
  await getDriverSettingsAll(homey)
  getDriverSettings()
  await load(homey)
}
