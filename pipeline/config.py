"""Plant constants, paths and thresholds. Every magic number in the pipeline lives here."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "ellume_forecast_task" / "data"
TRAIN_CSV = DATA_DIR / "train.csv"
TEST_CSV = DATA_DIR / "test.csv"
OUT_DIR = ROOT / "outputs"
FIG_DIR = OUT_DIR / "figures"
WEB_DATA_DIR = ROOT / "web" / "public" / "data"
PREDICTIONS_CSV = OUT_DIR / "predictions.csv"

# --- Plant (DATASET.md) ---
LATITUDE = 14.10
LONGITUDE = 77.28
ALTITUDE_M = 680
TIMEZONE = "Asia/Kolkata"
TILT_DEG = 15
AZIMUTH_DEG = 180
ALBEDO = 0.20
GAMMA_PDC = -0.0035  # per degC, relative to 25 degC cell temperature
DC_CAPACITY_KW = 12_500
AC_CAPACITY_KW = 10_000

# --- Raw-data quirks ---
NA_STRINGS = ["", "NA", "null"]
SENTINEL_LOW = -999.0
SENTINEL_HIGH = 9999.0
TIMESTAMP_FORMATS = ("%Y-%m-%d %H:%M:%S", "%d-%m-%Y %H:%M")
FORECAST_COLS = [
    "forecast_cloud_cover",
    "forecast_temp_c",
    "forecast_wind_ms",
    "forecast_humidity_pct",
]
MEASURED_COLS = [
    "measured_poa_wm2",
    "measured_module_temp_c",
    "measured_ambient_temp_c",
    "rainfall_mm",
    "ac_power_kw",
]
TARGET = "ac_power_kw"

# Physical plausibility bounds for forecast inputs (outside -> treated as missing)
FORECAST_BOUNDS = {
    "forecast_cloud_cover": (0.0, 1.0),
    "forecast_temp_c": (-10.0, 55.0),
    "forecast_wind_ms": (0.0, 60.0),
    "forecast_humidity_pct": (0.0, 100.0),
}
POA_MAX_WM2 = 1_500  # anything above is a spike, not sunlight

# --- Cleaning thresholds ---
DAYLIGHT_POA_WM2 = 50          # hour counts as "productive daylight" above this
MW_RATIO_MAX = 0.1             # kW per W/m2; normal plant sits at ~10, MW-logged days at ~0.01
MW_DAY_MIN_HOURS = 3           # a day needs this many low-ratio daylight hours to be called MW-logged
AC_SPIKE_TOLERANCE = 1.02      # > 2% above inverter rating is a meter spike, not clipping
FLATLINE_MIN_RUN = 3           # identical consecutive daytime readings -> stuck sensor
PR_LOW, PR_HIGH = 0.55, 1.30   # ratio of actual to physics-expected AC accepted as "normal availability"
PR_MIN_POA_WM2 = 150           # performance-ratio check only where irradiance is meaningful

# --- Validation ---
VALID_START = "2024-07-01"
VALID_END = "2024-09-01"       # exclusive; Jul-Aug 2024 mirrors the Jul-Aug 2025 test period
SEED = 42
