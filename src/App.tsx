import { useCallback, useEffect, useRef, useState } from "react";
import { BamFile, BamRecord } from "@gmod/bam";
import { RemoteFile, BlobFile } from "generic-filehandle";
import GranularRectLayout from "./layout";
import { StringParam, useQueryParams, withDefault } from "use-query-params";

function parseLocString(locString: string) {
  const [refName, rest] = locString.split(":");
  const [start, end] = rest.split("-");
  return { refName, start: +start, end: +end };
}

export function parseCigar(cigar = "") {
  return cigar.split(/([MIDNSHPX=])/);
}

// because we are using use-query-params without a router
export function useForceUpdate() {
  const [, setTick] = useState(0);
  const update = useCallback(() => {
    setTick((tick) => tick + 1);
  }, []);
  return update;
}

const featHeight = 10;
const width = 1800;
const height = 1000;
const snpcovheight = 100;
const initialLoc = "1:20000-40000";
const initialFile =
  "https://s3.amazonaws.com/1000genomes/phase3/data/HG00096/alignment/HG00096.mapped.ILLUMINA.bwa.GBR.low_coverage.20120522.bam";

function App() {
  const ref = useRef<HTMLCanvasElement>(null);
  const snpcovref = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useQueryParams({
    loc: withDefault(StringParam, initialLoc),
    file: withDefault(StringParam, initialFile),
  });
  const [readData, setReadData] = useState<BamRecord[]>();
  const [mpileupData, setMPileupData] = useState<number[]>();
  const [file, setFile] = useState(params.file);
  const [loc, setLoc] = useState(params.loc);
  const [error, setError] = useState<Error>();
  const forceUpdate = useForceUpdate();
  const [files, setFiles] = useState<FileList>();

  useEffect(() => {
    (async () => {
      let bam;
      if (files) {
        let bamIdx =
          files[0].name.endsWith("bam") || files[0].name.endsWith("cram")
            ? 0
            : 1;

        bam = new BamFile({
          bamFilehandle: new BlobFile(files[bamIdx]),
          baiFilehandle: new BlobFile(files[Number(!bamIdx)]),
        });
      } else {
        bam = new BamFile({
          bamFilehandle: new RemoteFile(params.file),
          baiFilehandle: new RemoteFile(params.file + ".bai"),
        });
      }
      await bam.getHeader();
      const { refName, start, end } = parseLocString(params.loc);
      var records = await bam.getRecordsForRange(refName, start - 1, end);
      setReadData(records);

      const vals: number[] = new Array(end - start).fill(0);
      records
        .filter((f) => !f.isSegmentUnmapped() && !f.isSecondary())
        .forEach((r) => {
          const s = r.get("start");
          const e = r.get("end");
          for (let i = s - start; i < e - start; i++) {
            if (i >= 0 && i < end - start) vals[i]++;
          }
        });
      setMPileupData(vals);
    })();
  }, [params.file, params.loc, files]);

  // this block draws the rectangles
  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const ctx = ref.current.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, height);
    const parsedLoc = parseLocString(params.loc);
    const bpPerPx = width / (parsedLoc.end - parsedLoc.start);
    const layout = new GranularRectLayout();
    readData?.forEach((feature) => {
      const start = feature.get("start");
      const end = feature.get("end");

      if (feature.isReverseComplemented()) {
        ctx.fillStyle = "#99f";
      } else {
        ctx.fillStyle = "#f99";
      }

      const leftPx = (start - parsedLoc.start) * bpPerPx;
      const width = (end - start) * bpPerPx;

      const y = layout.addRect(feature.id(), start, end, featHeight);

      ctx.fillRect(leftPx, y, width, featHeight);
    });
  }, [readData, params.loc]);

  useEffect(() => {
    if (!snpcovref.current) {
      return;
    }
    const ctx = snpcovref.current.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, snpcovheight);
    const parsedLoc = parseLocString(params.loc);
    const bpPerPx = width / (parsedLoc.end - parsedLoc.start);
    if (mpileupData) {
      const maxHeight = mpileupData.reduce((a, b) => Math.max(a, b), 0);
      for (let i = 0; i < mpileupData.length; i++) {
        const numReads = +mpileupData[i];
        const leftPx = i * bpPerPx;
        const width = bpPerPx;

        ctx.fillStyle = "#ccc";
        const h = (numReads / maxHeight) * snpcovheight;
        ctx.fillRect(leftPx, snpcovheight - h, width + 0.9, h);
      }
      ctx.fillStyle = "black";
      ctx.fillText(`[0, ${maxHeight}]`, 0, 20);
    }
  }, [mpileupData, params.loc]);

  return (
    <div>
      <p>
        Enter BAM/CRAM file and location. This app uses @gmod/bam, compare with{" "}
        <a href="https://cmdcolin.github.io/aioli_demo/">
          https://cmdcolin.github.io/aioli_demo/
        </a>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setParams({ file, loc });
          if (!fileRef.current) {
            return;
          }
          if (fileRef.current.files?.length) {
            setFiles(fileRef.current.files);
          }
          setMPileupData(undefined);
          setReadData(undefined);
          setError(undefined);
          forceUpdate();
        }}
      >
        <label htmlFor="url">URL: </label>
        <input
          id="url"
          type="text"
          value={file}
          style={{ minWidth: "75%" }}
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
      {error ? <div style={{ color: "red" }}>{error}</div> : null}
      <canvas ref={snpcovref} width={width} height={snpcovheight} />
      <canvas ref={ref} width={width} height={height} />
    </div>
  );
}

export default App;
