"""Allow running as ``python -m packages.monkey_test`` or ``python -m monkey_test``."""
try:
    from .runner import main
except ImportError:
    from runner import main  # type: ignore[no-redef]

if __name__ == "__main__":
    main()
