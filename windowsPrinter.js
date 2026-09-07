const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Windows Raw Printer Helper
 * Sends RAW ESC/POS byte buffers directly to Windows installed printers (USB / Network / Shared)
 * without opening any browser dialogs or GUI windows.
 */

let cachedPrinters = null;
let lastCheck = 0;

async function getInstalledPrinters() {
  const now = Date.now();
  if (cachedPrinters && (now - lastCheck < 30000)) {
    return cachedPrinters;
  }

  return new Promise((resolve) => {
    exec('powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"', (err, stdout) => {
      if (err || !stdout) {
        cachedPrinters = ['POS-80-Series'];
      } else {
        const list = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        cachedPrinters = list.length ? list : ['POS-80-Series'];
      }
      lastCheck = Date.now();
      resolve(cachedPrinters);
    });
  });
}

/**
 * Sends binary or string ESC/POS data directly to a Windows printer name (e.g. 'POS-80-Series')
 * @param {string} printerName Name of the Windows printer
 * @param {Buffer|string} data Raw ESC/POS bytes or text
 */
function sendRawToWindowsPrinter(printerName, data) {
  return new Promise((resolve) => {
    if (!printerName) {
      printerName = 'POS-80-Series';
    }

    const tempFile = path.join(os.tmpdir(), `gastropos_ticket_${Date.now()}_${Math.floor(Math.random() * 1000)}.bin`);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');

    fs.writeFile(tempFile, buffer, (writeErr) => {
      if (writeErr) {
        return resolve({ ok: false, error: writeErr.message });
      }

      const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendFileToPrinter(string szPrinterName, string szFileName) {
        byte[] bytes = File.ReadAllBytes(szFileName);
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "GastroBar ESC/POS Ticket";
        di.pDataType = "RAW";
        bool bSuccess = false;

        if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
"@

$targetPrinter = "${printerName.replace(/"/g, '`"')}"
$targetFile = "${tempFile.replace(/\\/g, '/')}"
$res = [RawPrinterHelper]::SendFileToPrinter($targetPrinter, $targetFile)
if ($res) {
    Write-Output "OK_PRINTED"
} else {
    Write-Output "FAILED_PRINT"
}
`;

      const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);
      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (d) => stdout += d.toString());
      ps.stderr.on('data', (d) => stderr += d.toString());

      ps.on('close', () => {
        fs.unlink(tempFile, () => {});
        if (stdout.includes('OK_PRINTED')) {
          resolve({ ok: true, mensaje: `Impreso directamente en ${printerName} (USB / Windows Spooler)` });
        } else {
          resolve({ ok: false, error: (stderr || stdout || 'Fallo al imprimir').trim() });
        }
      });

      ps.on('error', (err) => {
        fs.unlink(tempFile, () => {});
        resolve({ ok: false, error: err.message });
      });
    });
  });
}

module.exports = {
  getInstalledPrinters,
  sendRawToWindowsPrinter
};

