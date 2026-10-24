param (
    [Parameter(Mandatory=$true)]
    [string]$imagePath
)

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' 
    }

    function Await($asyncOp, $type) {
        $asTask = $asTaskGeneric.MakeGenericMethod($type)
        $netTask = $asTask.Invoke($null, @($asyncOp))
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    }

    [Windows.Media.Ocr.OcrEngine, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
    }

    $ocrResult = Await ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])

    $lines = @()
    foreach ($line in $ocrResult.Lines) {
        if ($line.Text -and $line.Text.Trim().Length -gt 0) {
            $lines += $line.Text.Trim()
        }
    }

    $output = @{
        success = $true
        fullText = $ocrResult.Text
        lines = $lines
    }

    $output | ConvertTo-Json -Depth 4
} catch {
    $errOutput = @{
        success = $false
        error = $_.Exception.Message
        lines = @()
        fullText = ""
    }
    $errOutput | ConvertTo-Json -Depth 3
}
