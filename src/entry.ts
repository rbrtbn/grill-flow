import { Runtime } from 'foldkit'

import { startInputRecorder } from './inputRecorder'
import { Message, Model, init, subscriptions, update } from './main'
import { view } from './view'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  routing: {
    onUrlRequest: request => Message.RequestedUrl({ request }),
    onUrlChange: url => Message.ChangedUrl({ url }),
  },
  container: document.getElementById('root'),
  devTools: {
    Message,
  },
})

startInputRecorder()

Runtime.run(application)
