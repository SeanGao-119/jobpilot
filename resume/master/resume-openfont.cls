% Intro Options
\ProvidesClass{resume-openfont}[2021/05/30 Abdullah's version]
\NeedsTeXFormat{LaTeX2e}
\DeclareOption{print}{\def\@cv@print{}}
\DeclareOption*{%
    \PassOptionsToClass{\CurrentOption}{article}
}
\ProcessOptions\relax
\LoadClass{article}

\RequirePackage[english]{babel}
\RequirePackage{fancyhdr}
\RequirePackage[hmargin=1cm, vmargin=0.94cm]{geometry}
\usepackage[hidelinks]{hyperref}
\RequirePackage{titlesec}
\RequirePackage{enumitem}
\RequirePackage{tabularx}
\RequirePackage{fontawesome}
\RequirePackage{lato-font}
\RequirePackage{raleway-font}
\RequirePackage{ulem}

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
\newcommand{\underlinedLink}[2]{\href{#1}{\uline{#2}}}
\newcommand{\singleItem}[2]{\normalsize{\textbf{#1} #2}}
\newcommand{\doubleItem}[4]{\singleItem{#1}{#2} & \singleItem{#3}{#4}}
\newcommand{\sectionsep}[0]{\vspace{7pt}}

\newenvironment{bullets}{
\vspace{-1mm}
\begin{itemize}
\itemsep1pt
\parskip1.5pt
\parsep1.5pt
}{
\end{itemize}
\vspace{-\topsep}
}

\newenvironment{skillList}{%
\noindent%
\begin{tabular*}{\textwidth}{@{\extracolsep{\fill}}ll}%
}{%
\end{tabular*}%
}

\let\oldSection\section
\renewcommand{\section}[1]{\oldSection{#1}\raggedright}
\renewcommand{\underline}[1]{\uline{#1}}
