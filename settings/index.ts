import Homey from 'homey/lib/Homey'
import { Building, ErrorLog, FrostProtectionData, HolidayModeData, MELCloudDevice } from '../types'

type ExtendedHomey = Homey & {
  api: (method: 'GET' | 'POST', path: string, body: any, callback: (error: string | null, data: any) => Promise<void>) => Homey.ManagerApi
  get: (name: string, callback: (error: string | null, value: string) => Promise<void>) => string
  set: (name: string, value: string, callback: (error: string | null) => Promise<void>) => Promise<void>
  alert: (message: string) => void
  confirm: (message: string, icon: string | null, callback: (error: string | null, ok: boolean) => Promise<void>) => void
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function onHomeyReady (Homey: ExtendedHomey): Promise<void> {
  await Homey.ready()

  function generateTableHead (table: any, keys: string[]): void {
    const thead = table.createTHead()
    const row = thead.insertRow()
    for (const key of keys) {
      const th = document.createElement('th')
      const text = document.createTextNode(key)
      th.appendChild(text)
      row.appendChild(th)
    }
  }
  function generateTable (table: any, data: ErrorLog): void {
    for (const error of data) {
      const row = table.insertRow()
      for (const value of Object.values(error)) {
        const cell = row.insertCell()
        const text = document.createTextNode(value)
        cell.appendChild(text)
      }
    }
  }
  Homey.api(
    'GET',
    '/report/error_log',
    null,
    async (error: string | null, data: ErrorLog): Promise<void> => {
      if (error !== null) {
        Homey.alert(error)
        return
      }
      if (data === null || data.length === 0) {
        return
      }
      const table = document.querySelector('table')
      generateTableHead(table, Object.keys(data[0]))
      generateTable(table, data)
    }
  )

  const usernameElement: HTMLInputElement = document.getElementById('username') as HTMLInputElement
  const passwordElement: HTMLInputElement = document.getElementById('password') as HTMLInputElement
  const saveElement: HTMLElement = document.getElementById('save') as HTMLElement
  Homey.get('username', async (err: string | null, username: string): Promise<void> => {
    if (err !== null) {
      Homey.alert(err)
      return
    }
    usernameElement.value = username
  })
  Homey.get('password', async (err: string | null, password: string): Promise<void> => {
    if (err !== null) {
      Homey.alert(err)
      return
    }
    passwordElement.value = password
  })
  saveElement.addEventListener('click', (): void => {
    Homey.api(
      'POST',
      '/login',
      { username: usernameElement.value, password: passwordElement.value },
      async (error: string | null, login: boolean): Promise<void> => {
        if (error !== null) {
          Homey.alert(error)
          return
        }
        if (!login) {
          Homey.alert('Authentication failed')
          return
        }
        await Homey.set('username', usernameElement.value, async (err: string | null): Promise<void> => {
          if (err !== null) {
            Homey.alert(err)
          }
        })
        await Homey.set('password', passwordElement.value, async (err: string | null): Promise<void> => {
          if (err !== null) {
            Homey.alert(err)
          }
        })
        Homey.alert('Authentication succeeded')
      }
    )
  })

  const intervalElement: HTMLInputElement = document.getElementById('interval') as HTMLInputElement
  const alwaysOnElement: HTMLInputElement = document.getElementById('always-on') as HTMLInputElement
  const applyElement: HTMLElement = document.getElementById('apply') as HTMLElement
  applyElement.addEventListener('click', (): void => {
    const body: any = {}
    if (intervalElement.value !== '') {
      const interval = Number(intervalElement.value)
      if (!Number.isInteger(interval) || interval < 1 || interval > 60) {
        Homey.alert('The frequency must be an integer between 1 and 60.')
        return
      }
      body.interval = interval
    }
    if (alwaysOnElement.value !== '') {
      body.always_on = alwaysOnElement.value === 'true'
    }
    if (Object.keys(body).length === 0) {
      Homey.alert('No change to apply')
      return
    }
    Homey.confirm(
      'Are you sure you want to override this setting on all devices?',
      null,
      async (error: string | null, ok: boolean): Promise<void> => {
        if (error !== null) {
          Homey.alert(error)
          return
        }
        if (!ok) {
          Homey.alert('Change has not been applied')
          return
        }
        Homey.api(
          'POST',
          '/settings/devices',
          body,
          async (error: string | null, success: boolean): Promise<void> => {
            if (error !== null) {
              Homey.alert(error)
              return
            }
            if (!success) {
              Homey.alert('No change to apply')
              return
            }
            Homey.alert('Change has been applied to all devices')
          }
        )
      }
    )
  })

  const buildingElement: HTMLInputElement = document.getElementById('building') as HTMLInputElement
  const holidayModeEnabledElement: HTMLInputElement = document.getElementById('enabled-holiday-mode') as HTMLInputElement
  const holidayModeStartDateElement: HTMLInputElement = document.getElementById('start-date') as HTMLInputElement
  const holidayModeEndDateElement: HTMLInputElement = document.getElementById('end-date') as HTMLInputElement
  const refreshHolidayModeElement: HTMLElement = document.getElementById('refresh-holiday-mode') as HTMLElement
  const updateHolidayModeElement: HTMLElement = document.getElementById('update-holiday-mode') as HTMLElement
  const frostProtectionEnabledElement: HTMLInputElement = document.getElementById('enabled-frost-protection') as HTMLInputElement
  const frostProtectionMinimumTemperatureElement: HTMLInputElement = document.getElementById('min') as HTMLInputElement
  const frostProtectionMaximumTemperatureElement: HTMLInputElement = document.getElementById('max') as HTMLInputElement
  const refreshFrostProtectionElement: HTMLElement = document.getElementById('refresh-frost-protection') as HTMLElement
  const updateFrostProtectionElement: HTMLElement = document.getElementById('update-frost-protection') as HTMLElement
  function getBuildingHolidayModeSettings (): void {
    Homey.api(
      'GET',
      `/settings/holiday_mode/buildings/${buildingElement.value}`,
      null,
      async (error: string | null, data: HolidayModeData): Promise<void> => {
        if (error !== null) {
          Homey.alert(error)
          return
        }
        if (data === null) {
          Homey.alert('Holiday mode settings could not be retrieved')
          return
        }
        holidayModeEnabledElement.value = String(data.HMEnabled)
        if (data.HMEnabled) {
          holidayModeStartDateElement.value = data.HMStartDate ?? ''
          holidayModeEndDateElement.value = data.HMEndDate ?? ''
        } else {
          holidayModeStartDateElement.value = ''
          holidayModeEndDateElement.value = ''
        }
      }
    )
  }
  function getBuildingFrostProtectionSettings (): void {
    Homey.api(
      'GET',
      `/settings/frost_protection/buildings/${buildingElement.value}`,
      null,
      async (error: string | null, data: FrostProtectionData): Promise<void> => {
        if (error !== null) {
          Homey.alert(error)
          return
        }
        if (data === null) {
          Homey.alert('Frost protection settings could not be retrieved')
          return
        }
        frostProtectionEnabledElement.value = String(data.FPEnabled)
        frostProtectionMinimumTemperatureElement.value = String(data.FPMinTemperature)
        frostProtectionMaximumTemperatureElement.value = String(data.FPMaxTemperature)
      }
    )
  }
  Homey.api(
    'GET',
    '/buildings',
    null,
    async (error: string | null, buildings: Array<Building<MELCloudDevice>>): Promise<void> => {
      if (error !== null) {
        Homey.alert(error)
        return
      }
      for (const building of buildings) {
        const { ID, Name } = building
        const option = document.createElement('option')
        option.setAttribute('value', String(ID))
        const optionText = document.createTextNode(Name)
        option.appendChild(optionText)
        buildingElement.appendChild(option)
      }
      getBuildingHolidayModeSettings()
      getBuildingFrostProtectionSettings()
    }
  )
  buildingElement.addEventListener('change', (): void => {
    getBuildingHolidayModeSettings()
    getBuildingFrostProtectionSettings()
  })

  holidayModeEnabledElement.addEventListener('change', (): void => {
    if (holidayModeEnabledElement.value === 'false') {
      holidayModeStartDateElement.value = ''
      holidayModeEndDateElement.value = ''
    }
  })
  refreshHolidayModeElement.addEventListener('click', (): void => {
    getBuildingHolidayModeSettings()
  })
  updateHolidayModeElement.addEventListener('click', (): void => {
    const enabled = holidayModeEnabledElement.value === 'true'
    Homey.api(
      'POST',
      `/settings/holiday_mode/buildings/${buildingElement.value}`,
      {
        enabled,
        startDate: enabled ? holidayModeStartDateElement.value : '',
        endDate: enabled ? holidayModeEndDateElement.value : ''
      },
      async (error: string | null, success: boolean): Promise<void> => {
        if (error !== null) {
          getBuildingHolidayModeSettings()
          Homey.alert(error)
          return
        }
        if (!success) {
          if (enabled && (holidayModeStartDateElement.value === '' || holidayModeEndDateElement.value === '')) {
            Homey.alert('Start Date and/or End Date are missing')
            return
          }
          if (holidayModeEndDateElement.value < holidayModeStartDateElement.value) {
            Homey.alert('End Date should be greater than Start Date')
            return
          }
          getBuildingHolidayModeSettings()
          Homey.alert('Update failed')
          return
        }
        getBuildingHolidayModeSettings()
        Homey.alert('Update succeeded')
      }
    )
  })

  refreshFrostProtectionElement.addEventListener('click', (): void => {
    getBuildingFrostProtectionSettings()
  })
  updateFrostProtectionElement.addEventListener('click', (): void => {
    const enabled = frostProtectionEnabledElement.value === 'true'
    Homey.api(
      'POST',
      `/settings/frost_protection/buildings/${buildingElement.value}`,
      {
        enabled,
        minimumTemperature: frostProtectionMinimumTemperatureElement.value,
        maximumTemperature: frostProtectionMaximumTemperatureElement.value
      },
      async (error: string | null, success: boolean): Promise<void> => {
        if (error !== null) {
          getBuildingFrostProtectionSettings()
          Homey.alert(error)
          return
        }
        if (!success) {
          getBuildingFrostProtectionSettings()
          Homey.alert('Update failed')
          return
        }
        Homey.alert('Update succeeded')
      }
    )
  })
}
