/// <reference types="vite/client" />

import "./styles.css";
import { bindModeTabs } from "./ui";
import { bindCameraControls } from "./camera";
import { bindPlateCapture } from "./plate";

bindModeTabs();
bindCameraControls();
bindPlateCapture();
