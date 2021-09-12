import './styles.css'
import ffmpeg from 'ffmpeg.js/ffmpeg-mp4.js'
import RecordRTC from 'recordrtc'
var stdout = ''
var stderr = ''
var workerPath = 'https://archive.org/download/ffmpeg_asm/ffmpeg_asm.js'
var log = console.log

function processInWebWorker() {
  var blob = URL.createObjectURL(
    new Blob(
      [
        'importScripts("' +
          workerPath +
          '");var now = Date.now;function print(text) {postMessage({"type" : "stdout","data" : text});};onmessage = function(event) {var message = event.data;if (message.type === "command") {var Module = {print: print,printErr: print,files: message.files || [],arguments: message.arguments || [],TOTAL_MEMORY: message.TOTAL_MEMORY || false};postMessage({"type" : "start","data" : Module.arguments.join(" ")});postMessage({"type" : "stdout","data" : "Received command: " +Module.arguments.join(" ") +((Module.TOTAL_MEMORY) ? ".  Processing with " + Module.TOTAL_MEMORY + " bits." : "")});var time = now();var result = ffmpeg_run(Module);var totalTime = now() - time;postMessage({"type" : "stdout","data" : "Finished processing (took " + totalTime + "ms)"});postMessage({"type" : "done","data" : result,"time" : totalTime});}};postMessage({"type" : "ready"});',
      ],
      {
        type: 'application/javascript',
      },
    ),
  )
  var worker = new Worker(blob)
  URL.revokeObjectURL(blob)
  return worker
}
var worker
function convertStreams(videoBlob) {
  var aab
  var buffersReady
  var workerReady
  var posted
  var fileReader = new FileReader()
  fileReader.onload = function() {
    aab = this.result
    postMessage()
  }
  fileReader.readAsArrayBuffer(videoBlob)
  if (!worker) {
    worker = processInWebWorker()
  }
  worker.onmessage = function(event) {
    var message = event.data
    if (message.type === 'ready') {
      log(
        '<a href="' +
          workerPath +
          '" download="ffmpeg-asm.js">ffmpeg-asm.js</a> file has been loaded.',
      )
      workerReady = true
      if (buffersReady) postMessage()
    } else if (message.type === 'stdout') {
      log(message.data)
    } else if (message.type === 'start') {
      log(
        '<a href="' +
          workerPath +
          '" download="ffmpeg-asm.js">ffmpeg-asm.js</a> file received ffmpeg command.',
      )
    } else if (message.type === 'done') {
      log(JSON.stringify(message))
      var result = message.data[0]
      log(JSON.stringify(result))
      var blob = new File([result.data], 'test.mp4', {
        type: 'video/mp4',
      })
      log(JSON.stringify(blob))
    }
  }
  var postMessage = function() {
    posted = true
    worker.postMessage({
      type: 'command',
      arguments: '-i video.webm -c:v mpeg4 -b:v 640k -c:a aac -b:c 96k -strict experimental output.mp4'.split(
        ' ',
      ),
      files: [
        {
          data: new Uint8Array(aab),
          name: 'video.webm',
        },
      ],
    })
  }
}

if (!navigator.getDisplayMedia && !navigator.mediaDevices.getDisplayMedia) {
  var error = 'Your browser does NOT supports getDisplayMedia API.'
  document.querySelector('h1').innerHTML = error
  document.querySelector('video').style.display = 'none'
  document.getElementById('btn-start-recording').style.display = 'none'
  document.getElementById('btn-stop-recording').style.display = 'none'
  throw new Error(error)
}

function invokeGetDisplayMedia(success, error) {
  var displaymediastreamconstraints = {
    video: {
      displaySurface: 'monitor', // monitor, window, application, browser
      logicalSurface: true,
      cursor: 'always', // never, always, motion
    },
  }
  // above constraints are NOT supported YET
  // that's why overridnig them
  displaymediastreamconstraints = {
    video: true,
  }
  if (navigator.mediaDevices.getDisplayMedia) {
    navigator.mediaDevices
      .getDisplayMedia(displaymediastreamconstraints)
      .then(success)
      .catch(error)
  } else {
    navigator
      .getDisplayMedia(displaymediastreamconstraints)
      .then(success)
      .catch(error)
  }
}

function captureScreen(callback) {
  invokeGetDisplayMedia(
    function(screen) {
      addStreamStopListener(screen, function() {
        if (window.stopCallback) {
          window.stopCallback()
        }
      })
      callback(screen)
    },
    function(error) {
      console.error(error)
      alert(
        'Unable to capture your screen. Please check console logs.\n' + error,
      )
    },
  )
}

function captureCamera(cb) {
  navigator.mediaDevices
    .getUserMedia({
      audio: true,
      video: true,
    })
    .then(cb)
}

function keepStreamActive(stream) {
  var video = document.createElement('video')
  video.muted = true
  video.srcObject = stream
  video.style.display = 'none'
  ;(document.body || document.documentElement).appendChild(video)
}
captureScreen(function(screen) {
  keepStreamActive(screen)
  captureCamera(function(camera) {
    keepStreamActive(camera)
    screen.width = window.screen.width
    screen.height = window.screen.height
    screen.fullcanvas = true
    camera.width = 320
    camera.height = 240
    camera.top = screen.height - camera.height
    camera.left = screen.width - camera.width
    var recorder = RecordRTC([screen, camera], {
      type: 'video',
      mimeType: 'video/webm',
      previewStream: function(s) {
        document.querySelector('video').muted = true
        document.querySelector('video').srcObject = s
      },
    })
    recorder.startRecording()
    window.stopCallback = function() {
      window.stopCallback = null
      recorder.stopRecording(function() {
        var blob = recorder.getBlob()
        document.querySelector('video').srcObject = null
        document.querySelector('video').src = URL.createObjectURL(blob)
        document.querySelector('video').muted = false
        ;[screen, camera].forEach(function(stream) {
          stream.getTracks().forEach(function(track) {
            track.stop()
          })
        })
        ffmpeg({
          arguments: [
            '-i video.webm -c:v mpeg4 -b:v 640k -c:a aac -b:c 96k -strict experimental output.mp4'.split(
              ' ',
            ),
          ],
          print: function(data) {
            stdout += data + '\n'
          },
          printErr: function(data) {
            stderr += data + '\n'
          },
          onExit: function(code) {
            console.log('Process exited with code ' + code)
            console.log(stdout)
          },
        })
      })
    }
    window.timeout = setTimeout(window.stopCallback, 2 * 1000)
  })
})

function addStreamStopListener(stream, callback) {
  stream.addEventListener(
    'ended',
    function() {
      callback()
      callback = function() {}
    },
    false,
  )
  stream.addEventListener(
    'inactive',
    function() {
      callback()
      callback = function() {}
    },
    false,
  )
  stream.getTracks().forEach(function(track) {
    track.addEventListener(
      'ended',
      function() {
        callback()
        callback = function() {}
      },
      false,
    )
    track.addEventListener(
      'inactive',
      function() {
        callback()
        callback = function() {}
      },
      false,
    )
  })
}
