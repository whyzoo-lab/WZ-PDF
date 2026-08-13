// hwp2pdf — console front end for WZ PDF's HWP/HWPX → PDF converter.
//
// The converter itself cannot live here: @rhwp/core renders into a canvas and
// the PDF is composited from those canvases, so it needs the app's Chromium.
// This is the missing console half of that: WZ PDF.exe is a GUI-subsystem
// binary, so when it is started straight from cmd it has no console to write to
// and its output vanishes. A console-subsystem process does have one, and a
// child started with inherited handles writes to it — so this launcher exists
// purely to lend the app a console and pass the exit code back.
//
// Built with the csc.exe that ships with Windows (.NET Framework 4.x), so the
// project gains no toolchain: see scripts/build-cli.cjs.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

static class Hwp2Pdf
{
    const string AppExe = "WZ PDF.exe";
    const string ConvertFlag = "--hwp2pdf";

    static int Main(string[] args)
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string app = Path.Combine(dir, AppExe);

        if (!File.Exists(app))
        {
            Console.Error.WriteLine("hwp2pdf: cannot find \"" + AppExe + "\" next to this program.");
            Console.Error.WriteLine("It is installed alongside WZ PDF; run it from the install folder.");
            return 2;
        }

        var psi = new ProcessStartInfo(app);
        psi.Arguments = ConvertFlag + " " + Quote(args);
        // No redirection and no shell: the child inherits this console's
        // handles, so its stdout/stderr land straight in the caller's terminal.
        psi.UseShellExecute = false;

        try
        {
            using (Process child = Process.Start(psi))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("hwp2pdf: could not start the converter — " + ex.Message);
            return 2;
        }
    }

    /// Re-quote arguments for the child. Windows gives every process one command
    /// line, so an argument containing spaces has to be quoted again or it
    /// arrives split in two — which is exactly what happens to the file names
    /// this tool is given.
    static string Quote(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string arg in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
            {
                sb.Append(arg);
                continue;
            }
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"')
                {
                    // Backslashes before a quote must be doubled, then the quote escaped.
                    sb.Append('\\', backslashes * 2 + 1).Append('"');
                }
                else
                {
                    sb.Append('\\', backslashes).Append(c);
                }
                backslashes = 0;
            }
            // Trailing backslashes would otherwise escape the closing quote.
            sb.Append('\\', backslashes * 2).Append('"');
        }
        return sb.ToString();
    }
}
