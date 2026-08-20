// Console front end for WZ PDF's batch converters.
//
// One source, compiled to three executables — hwp2pdf.exe, hwp2hwpx.exe and
// hwpx2hwp.exe (see scripts/build-cli.cjs). Each decides what to do from its
// own file name, so the delicate part — re-quoting the command line — exists
// once instead of three times.
//
// Why a launcher at all: "WZ PDF.exe" is a GUI-subsystem binary, so when it is
// started straight from cmd it has no console to write to and its output
// vanishes. A console-subsystem process does have one, and a child started with
// inherited handles writes to it. Lending the app a console and passing the
// exit code back is this program's whole job — the conversion happens in the
// app.
//
// Built with the csc.exe that ships with Windows (.NET Framework 4.x), so the
// project gains no toolchain: see scripts/build-cli.cjs.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

static class WzConvert
{
    const string AppExe = "WZ PDF.exe";

    // The switches the app accepts. Checking the file name against this list
    // rather than passing "--" + name means a renamed copy of this launcher
    // cannot hand the app an arbitrary switch.
    static readonly string[] Tools = { "hwp2pdf", "hwp2hwpx", "hwpx2hwp" };

    static int Main(string[] args)
    {
        string location = Assembly.GetExecutingAssembly().Location;
        string dir = Path.GetDirectoryName(location);
        string tool = Path.GetFileNameWithoutExtension(location).ToLowerInvariant();

        if (Array.IndexOf(Tools, tool) < 0)
        {
            Console.Error.WriteLine("This program must be named one of: " + string.Join(", ", Tools) + ".");
            return 2;
        }

        string app = Path.Combine(dir, AppExe);
        if (!File.Exists(app))
        {
            Console.Error.WriteLine(tool + ": cannot find \"" + AppExe + "\" next to this program.");
            Console.Error.WriteLine("It is installed alongside WZ PDF; run it from the install folder.");
            return 2;
        }

        var psi = new ProcessStartInfo(app);
        psi.Arguments = "--" + tool + " " + Quote(args);
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
            Console.Error.WriteLine(tool + ": could not start the converter — " + ex.Message);
            return 2;
        }
    }

    /// Re-quote arguments for the child. Windows gives every process one command
    /// line, so an argument containing spaces has to be quoted again or it
    /// arrives split in two — which is exactly what happens to the file names
    /// and folder paths this tool is given.
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
