% Intro Options
\ProvidesClass{resume-openfont}[2026/08/26 JobPilot TeX Live 2026 compatibility]
\NeedsTeXFormat{LaTeX2e}
\DeclareOption{print}{\def\@cv@print{}}
\DeclareOption*{%
    \PassOptionsToClass{\CurrentOption}{article}
}
\ProcessOptions\relax
\LoadClass{article}

\RequirePackage[english]{babel}
\RequirePackage{fancyhdr}
\RequirePackage[a4paper,hmargin=1.15cm, vmargin=1.05cm]{geometry}
\usepackage[hidelinks]{hyperref}
\RequirePackage{titlesec}
\RequirePackage{enumitem}
\RequirePackage{tabularx}
\RequirePackage{xcolor}

% Portable font layer: XeLaTeX can use the widely available URW Nimbus Sans
% without depending on optional distro-specific lato/raleway LaTeX packages.
\RequirePackage{fontspec}
\setsansfont{Nimbus Sans}
\renewcommand{\familydefault}{\sfdefault}

% Preserve the original template macro names and font weights.
\newcommand{\latoRegular}[1]{{\fontseries{m}\selectfont #1}}
\newcommand{\customLatoLight}{\fontseries{m}\selectfont}
\newcommand{\customLatoBlack}{\bfseries}
\newcommand{\customRalewayMedium}{\fontseries{m}\selectfont}

% Current JobPilot template uses ProjectNoLink, so FontAwesome is not required.
% Keep Project usable without forcing a legacy FontAwesome system font install.
\providecommand{\faExternalLink}{}

\definecolor{headings}{HTML}{6A6A6A}
\definecolor{subheadings}{HTML}{333333}

\titlespacing{\section}{0pt}{0pt}{0pt}
\titleformat{\section}{%
\color{headings}%
\scshape%
\customLatoLight%
\fontsize{16pt}{24pt}%
\selectfont%
\raggedright%
\uppercase%
} {}{0em}{}

\titlespacing{\subsection}{0pt}{\parskip}{-\parskip}
\titleformat{\subsection}{%
\color{subheadings}%
\customLatoBlack%
\fontsize{12pt}{12pt}%
\selectfont%
\bfseries%
\uppercase%
\normalfont%
} {}{0em}{}

\newcommand{\resetHeaderAndFooter}{%
\fancyhf{}%
\fancyfoot{}%
\renewcommand{\headrulewidth}{0pt}%
\renewcommand{\footrulewidth}{0pt}%
}

\newcommand{\NoSpace}{\vspace*{-2pt}}
\newcommand{\fakeNewLine}{\newline \vspace{-\baselineskip}}
\newcommand{\alignProfileTable}{\raggedbottom\raggedright\setlength{\tabcolsep}{0in}}

\newcommand{\runsubsection}[1]{%
\color{subheadings}%
\customLatoBlack%
\fontsize{12pt}{12pt}%
\selectfont%
\bfseries%
#1%
\normalfont}%

\newcommand{\descript}[1]{%
\color{subheadings}%
\raggedright%
\fontsize{11pt}{13pt}%
\selectfont{#1}%
\normalfont}

\newcommand{\location}[1]{%
\color{headings}%
\raggedright%
\customRalewayMedium%
\fontsize{11pt}{11pt}%
\selectfont{#1}%
\normalfont}

\newcommand{\minorSection}[1]{%
\color{subheadings}%
\raggedright%
\scshape%
\customRalewayMedium%
\fontsize{11pt}{12pt}%
\selectfont{#1}%
\normalfont}

\newcommand{\Project}[2]{\runsubsection{\href{#2}{\uppercase{#1} \,\faExternalLink}}\hfill}
\newcommand{\ProjectNoLink}[1]{\runsubsection{{\uppercase{#1}}}\hfill}
\newcommand{\underlinedLink}[2]{\href{#1}{\underline{#2}}}
\newcommand{\singleItem}[2]{\normalsize{\textbf{#1} #2}}
\newcommand{\doubleItem}[4]{\singleItem{#1}{#2} & \singleItem{#3}{#4}}
\newcommand{\sectionsep}[0]{\vspace{7pt}}

\newenvironment{bullets}{
\begin{itemize}[leftmargin=2em, topsep=2pt, itemsep=1pt, parsep=0pt, partopsep=0pt]
}{
\end{itemize}
}

\newenvironment{skillList}{%
\noindent%
\begin{tabular*}{\textwidth}{@{\extracolsep{\fill}}ll}%
}{%
\end{tabular*}%
}

\let\oldSection\section
\renewcommand{\section}[1]{\oldSection{#1}\raggedright}
