import { useCallback, useEffect, useRef, useState } from 'react'
import { BamFile, BamRecord } from '@gmod/bam'
import { RemoteFile, BlobFile } from 'generic-filehandle'
import GranularRectLayout from './layout'
import { StringParam, useQueryParams, withDefault } from 'use-query-params'
import { Canvas, extend, useThree, useFrame } from '@react-three/fiber'

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

// Calling extend with the native OrbitControls class from Three.js
// will make orbitControls available as a native JSX element.
// Notice how the OrbitControls classname becomes lowercase orbitControls when used as JSX element.
extend({ OrbitControls })

function parseLocString(locString: string) {
  const [refName, rest] = locString.split(':')
  const [start, end] = rest.split('-')
  return { refName, start: +start, end: +end }
}

export function parseCigar(cigar = '') {
  return cigar.split(/([MIDNSHPX=])/)
}

// because we are using use-query-params without a router
export function useForceUpdate() {
  const [, setTick] = useState(0)
  const update = useCallback(() => {
    setTick((tick) => tick + 1)
  }, [])
  return update
}

const featHeight = 10
const width = 1800
const snpcovheight = 100
const initialLoc = '1:20000-21000'
const initialFile =
  'https://s3.amazonaws.com/1000genomes/phase3/data/HG00096/alignment/HG00096.mapped.ILLUMINA.bwa.GBR.low_coverage.20120522.bam'

function Box(props: any) {
  const { width, height, color } = props
  const [hovered, setHover] = useState(false)
  const [active, setActive] = useState(false)
  return (
    <mesh
      {...props}
      onClick={() => setActive(!active)}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        color={color || (active ? 'green' : hovered ? 'hotpink' : 'orange')}
      />
    </mesh>
  )
}

const CameraControls = () => {
  // Get a reference to the Three.js Camera, and the canvas html element.
  // We need these to setup the OrbitControls class.
  // https://threejs.org/docs/#examples/en/controls/OrbitControls

  const {
    camera,
    gl: { domElement },
  } = useThree()

  // Ref to the controls, so that we can update them on every frame using useFrame
  const controls = useRef<any>()
  useFrame(() => controls.current.update())
  return (
    //@ts-ignore
    <orbitControls
      ref={controls}
      args={[camera, domElement]}
      enableZoom={true}
      maxAzimuthAngle={Math.PI / 3}
      maxPolarAngle={Math.PI}
      minAzimuthAngle={-Math.PI / 3}
      minPolarAngle={0}
    />
  )
}

function App() {
  const snpcovref = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [params, setParams] = useQueryParams({
    loc: withDefault(StringParam, initialLoc),
    file: withDefault(StringParam, initialFile),
  })
  const [layout, setLayout] = useState<any>()
  const [readData, setReadData] = useState<BamRecord[]>()
  const [mpileupData, setMPileupData] = useState<number[]>()
  const [file, setFile] = useState(params.file)
  const [loc, setLoc] = useState(params.loc)
  const [error, setError] = useState<Error>()
  const forceUpdate = useForceUpdate()
  const [files, setFiles] = useState<FileList>()

  const rects = layout ? [...layout.rectangles.entries()] : undefined
  const parsedLoc = parseLocString(params.loc)
  const bpPerPx = (width / (parsedLoc.end - parsedLoc.start)) * 10

  useEffect(() => {
    ;(async () => {
      let bam
      if (files) {
        let bamIdx =
          files[0].name.endsWith('bam') || files[0].name.endsWith('cram')
            ? 0
            : 1

        bam = new BamFile({
          bamFilehandle: new BlobFile(files[bamIdx]),
          baiFilehandle: new BlobFile(files[Number(!bamIdx)]),
        })
      } else {
        bam = new BamFile({
          bamFilehandle: new RemoteFile(params.file),
          baiFilehandle: new RemoteFile(params.file + '.bai'),
        })
      }
      await bam.getHeader()
      const { refName, start, end } = parseLocString(params.loc)
      var records = await bam.getRecordsForRange(refName, start - 1, end)
      setReadData(records)

      const vals: number[] = new Array(end - start).fill(0)
      records
        .filter((f) => !f.isSegmentUnmapped() && !f.isSecondary())
        .forEach((r) => {
          const s = r.get('start')
          const e = r.get('end')
          for (let i = s - start; i < e - start; i++) {
            if (i >= 0 && i < end - start) {
              vals[i]++
            }
          }
        })
      setMPileupData(vals)
    })()
  }, [params.file, params.loc, files])

  // this block draws the rectangles
  useEffect(() => {
    const layout = new GranularRectLayout()
    readData?.forEach((feature) => {
      const start = feature.get('start')
      const end = feature.get('end')

      layout.addRect(`${feature.id()}`, start, end, featHeight, feature)
    })
    setLayout(layout)
  }, [readData, params.loc])

  useEffect(() => {
    if (!snpcovref.current) {
      return
    }
    const ctx = snpcovref.current.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, width, snpcovheight)
    if (mpileupData) {
      const maxHeight = mpileupData.reduce((a, b) => Math.max(a, b), 0)
      for (let i = 0; i < mpileupData.length; i++) {
        const numReads = +mpileupData[i]
        const leftPx = i * bpPerPx
        const width = bpPerPx

        ctx.fillStyle = '#ccc'
        const h = (numReads / maxHeight) * snpcovheight
        ctx.fillRect(leftPx, snpcovheight - h, width + 0.9, h)
      }
      ctx.fillStyle = 'black'
      ctx.fillText(`[0, ${maxHeight}]`, 0, 20)
    }
  }, [mpileupData, bpPerPx])

  return (
    <div>
      <p>Enter BAM/CRAM file and location. This app uses @gmod/bam</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setParams({ file, loc })
          if (!fileRef.current) {
            return
          }
          if (fileRef.current.files?.length) {
            setFiles(fileRef.current.files)
          }
          setMPileupData(undefined)
          setReadData(undefined)
          setError(undefined)
          forceUpdate()
        }}
      >
        <label htmlFor="url">URL: </label>
        <input
          id="url"
          type="text"
          value={file}
          style={{ minWidth: '75%' }}
          onChange={(event) => setFile(event.target.value)}
        />

        <br />
        <label htmlFor="file">File (import both BAM and BAI): </label>
        <input id="file" ref={fileRef} type="file" multiple />

        <br />
        <label htmlFor="loc">Location: </label>
        <input
          id="loc"
          type="text"
          value={loc}
          onChange={(event) => setLoc(event.target.value)}
        />
        <button type="submit">Submit</button>
      </form>
      {!readData ? <div className="dots">Loading...</div> : null}
      {error ? <div style={{ color: 'red' }}>{error}</div> : null}
      <div style={{ width: '100%', height: 800, margin: 100 }}>
        <Canvas camera={{ position: [0, 0, 800], near: 5, far: 15000 }}>
          <CameraControls />
          <ambientLight />
          {rects?.map(([key, val]) => {
            const { minX: start, maxX: end, minY, maxY } = val
            const left = (start - parsedLoc.start) * bpPerPx
            const width = (end - start) * bpPerPx
            const height = maxY - minY
            return (
              <Box
                key={key}
                width={width}
                height={height}
                position={[left - 900, minY + 200, 0]}
              />
            )
          })}

          {mpileupData?.map((val, index) => {
            const left = index * bpPerPx
            const width = bpPerPx
            const height = val * 20
            return (
              <Box
                key={val + '-' + index}
                width={width}
                height={height}
                color={'grey'}
                position={[left - 900, 180 - height / 2, 0]}
              />
            )
          })}
        </Canvas>
        ,
      </div>
    </div>
  )
}

export default App
