const app = require('../../../lib/app')
const { createApi, generateKeys, payload } = require('../../helpers')
const pg = require('../../../__mocks__/pg')
const express = require('express')
const { serialize } = require('jwks-provider')
const { getKey } = require('jwks-manager')
jest.mock('jwks-manager', () => ({
  getKey: jest.fn()
}))
const { get: consentServiceGet } = require('../../../lib/services/consents')
jest.mock('../../../lib/services/consents', () => ({
  get: jest.fn()
}))

describe('routes api/clients', () => {
  let clientKeys, clientHost
  beforeAll(async () => {
    clientKeys = await generateKeys('sig', 'http://this-should-be-changed-to-match-clientHost.work/jwks/client_key')

    const clientApp = express()
    clientApp.get('/jwks', (_, res) => {
      res.send(serialize([clientKeys]))
    })
    await new Promise((resolve) => {
      clientHost = clientApp.listen(() => {
        resolve()
      })
    })
  })
  afterAll(() => {
    clientHost.close()
  })

  let api
  beforeEach(() => {
    api = createApi(app)
  })
  afterEach(() => {
    pg.clearMocks()
  })
  describe('POST /', () => {
    let data, clients
    beforeEach(() => {
      getKey.mockResolvedValue({ rsaPublicKey: clientKeys.publicKey })

      data = {
        clientId: `http://localhost:${clientHost.address().port}`,
        displayName: 'C:V - Create your digital Curriculum Vitae',
        description: 'Integrates with MyData - you are in complete control',
        eventsUrl: `http://localhost:${clientHost.address().port}/events`,
        jwksUrl: `http://localhost:${clientHost.address().port}/jwks`
      }

      clients = []
      pg.connection.query.mockImplementation((sql, params) => {
        if (/SELECT \* FROM clients/.test(sql)) {
          return Promise.resolve({
            rows: clients.filter(c => c.client_id === params[0])
          })
        } else if (/INSERT INTO clients/.test(sql)) {
          const [clientId, displayName, description, jwksUrl, eventsUrl, clientKey] = params
          const client = { clientId, displayName, description, jwksUrl, eventsUrl, clientKey }
          const ix = clients.indexOf(client)
          if (ix === -1) clients.splice(ix, 1, client)
          else clients.push(client)
          return Promise.resolve({ rowCount: 1 })
        } else {
          return Promise.resolve({ rows: [] })
        }
      })
    })

    it('throws if clientId is missing', async () => {
      data.clientId = undefined
      const response = await api.post('/api/clients', payload(data, clientKeys))
      expect(response.body.details[0].message).toEqual('"clientId" is required')
      expect(response.status).toEqual(400)
    })
    it('throws if displayName is missing', async () => {
      data.displayName = undefined
      const response = await api.post('/api/clients', payload(data, clientKeys))
      expect(response.body.details[0].message).toEqual('"displayName" is required')
      expect(response.status).toEqual(400)
    })
    it('throws if description is missing', async () => {
      data.description = undefined
      const response = await api.post('/api/clients', payload(data, clientKeys))
      expect(response.body.details[0].message).toEqual('"description" is required')
      expect(response.status).toEqual(400)
    })
    it('throws if eventsUrl is missing', async () => {
      data.eventsUrl = undefined
      const response = await api.post('/api/clients', payload(data, clientKeys))
      expect(response.body.details[0].message).toEqual('"eventsUrl" is required')
      expect(response.status).toEqual(400)
    })
    it('creates a client and saves it to db', async () => {
      await api.post('/api/clients', payload(data, clientKeys))

      expect(pg.connection.query).toHaveBeenCalledTimes(2)
      expect(pg.connection.query).toHaveBeenLastCalledWith(expect.any(String), [
        data.clientId,
        data.displayName,
        data.description,
        data.jwksUrl,
        data.eventsUrl,
        clientKeys.publicKey
      ])
    })
    it('responds with 200', async () => {
      const response = await api.post('/api/clients', payload(data, clientKeys))
      expect(response.body.message).toBeUndefined()
      expect(response.status).toEqual(200)
    })
  })

  describe('GET /:clientId/consents', () => {
    const accountId = '1944f102-5eaa-4c95-8f32-a9d12c0d4823'
    const clientId = encodeURIComponent('https://someservice.tld')
    const consentServiceGetResult = [
      {
        some: 'value',
        and: 'more'
      }, {
        stuff: 'from',
        the: 'database'
      }
    ]
    consentServiceGet.mockImplementation(() => consentServiceGetResult)

    it('throws if clientId is malformed', async () => {
      const response = await api.get(`/api/clients/INVALID/consents?accountId=${accountId}`)
      expect(response.body.details[0].message).toEqual('"clientId" must be a valid uri with a scheme matching the http|https pattern')
      expect(response.status).toEqual(400)
    })

    it('throws if accountId is missing from request parameters', async () => {
      const response = await api.get(`/api/clients/${clientId}/consents`)
      expect(response.body.details[0].message).toEqual('"accountId" is required')
      expect(response.status).toEqual(400)
    })

    it('does not throw for correct request', async () => {
      const response = await api.get(`/api/clients/${clientId}/consents?accountId=${accountId}`)
      expect(response.status).toEqual(200)
    })

    it('calls the consent service with given ids', async () => {
      await api.get(`/api/clients/${clientId}/consents?accountId=${accountId}`)
      expect(consentServiceGet).toBeCalledTimes(1)
      expect(consentServiceGet).toBeCalledWith(accountId, decodeURIComponent(clientId))
    })

    it('returns result from consent service', async () => {
      const result = await api.get(`/api/clients/${clientId}/consents?accountId=${accountId}`)
      expect(result.body).toEqual(consentServiceGetResult)
    })
  })
})
