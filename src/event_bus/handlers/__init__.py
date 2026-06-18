import pkgutil
import importlib

__all__ = []

for loader, module_name, is_pkg in pkgutil.iter_modules(__path__):
    importlib.import_module(f".{module_name}", package=__name__)
    __all__.append(module_name)