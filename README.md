# BiteScript RTC

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

BiteScript RTC is a real-time communication service designed to power WebRTC-based applications. It provides signaling and coordination services for establishing peer-to-peer connections between clients, enabling features like video/audio calls, file sharing, and real-time data transfer.

## ✨ Features

- **WebRTC Signaling Server**: Manages the connection setup between peers
- **Real-time Communication**: Enables low-latency peer-to-peer connections
- **Secure**: Implements security best practices including rate limiting and CORS
- **Scalable**: Built with performance and scalability in mind
- **TypeScript**: Written in TypeScript for better developer experience and type safety

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm (comes with Node.js) or yarn

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/biteScript/bitescript-rtc.git
   cd bitescript-rtc
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with your configuration:
   ```env
   PORT=3000
   NODE_ENV=development
   # Add other environment variables as needed
   ```

### Development

To start the development server with hot-reload:

```bash
npm run dev
```

### Building for Production

To build the project for production:

```bash
npm run build
```

### Running in Production

```bash
npm start
```

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Web Framework**: Express.js
- **WebSocket**: ws
- **Authentication**: Firebase Admin
- **Security**: Helmet, CORS, Rate Limiting
- **Validation**: Zod, express-validator
- **Monitoring**: Prometheus metrics

## 📜 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Contact

BiteScript Team - [GitHub Issues](https://github.com/biteScript/bitescript-rtc/issues)

Project Link: [https://github.com/biteScript/bitescript-rtc](https://github.com/biteScript/bitescript-rtc)

## 🙏 Acknowledgments

- [WebRTC](https://webrtc.org/) - For making real-time communication possible
- [Express.js](https://expressjs.com/) - For the fast, unopinionated web framework
- [TypeScript](https://www.typescriptlang.org/) - For type safety and better developer experience
- [All Contributors](https://github.com/biteScript/bitescript-rtc/graphs/contributors) - Who have contributed to this project
