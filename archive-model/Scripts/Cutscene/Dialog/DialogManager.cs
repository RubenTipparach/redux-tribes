using System;
using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Events;

[Serializable]
public class DialogLine
{
    public string Speaker;
    public string Text;
}



public class DialogManager : MonoBehaviour
{
    public List<DialogLine> lines;
    public TextMeshProUGUI dialogText;
    public TextMeshProUGUI speakerName;

    private Dictionary<string, TweeNode> dialogMap;
    private Queue<DialogLine> currentLines;
    public string nextNode;
    public string currentNode;

    public GameObject choiceContainer;
    public Button choiceButtonPrefab;

    public TextAsset tweeFile;
    public string startNode = "Start"; // Optional: Choose where to begin

    public Button continueButton;

    private Coroutine revealCoroutine;
    private bool isRevealing;
    private string currentFullText;

    public List<DialogEvent> eventTriggers;

    void Awake()
    {
        continueButton = Instantiate(choiceButtonPrefab,
            choiceContainer.transform);
        continueButton.gameObject.name = "Continue";
        continueButton.GetComponentInChildren<TextMeshProUGUI>().text = "Continue";
        continueButton.gameObject.SetActive(false);
        continueButton.onClick.AddListener(OnContinueClicked);
    }
    private void OnContinueClicked()
    {
        if (isRevealing)
        {
            if (revealCoroutine != null) StopCoroutine(revealCoroutine);
            dialogText.text = currentFullText;
            isRevealing = false;
            continueButton.gameObject.SetActive(true);
        }
        else
        {
            continueButton.gameObject.SetActive(false);
            ShowNextLine();
        }
    }

    private bool HasChoices(string nodeName)
    {
        return dialogMap.TryGetValue(nodeName, out var node) && node.Choices.Count > 0;
    }

    public void BeginSequence()
    {
        Debug.Log("called dialog manager");
        if (tweeFile != null)
        {
            LoadDialog(tweeFile.text, startNode);
        }
        else
        {
            Debug.LogWarning("No Twee file assigned to DialogManager.");
        }
    }

    public void TriggerSequence(TextAsset lineFile, string startNode)
    {
        if (lineFile != null)
        {
            LoadDialog(lineFile.text, startNode);
        }
        else
        {
            Debug.LogWarning("No Twee file assigned to DialogManager.");
        }
    }

    public void LoadDialog(string tweeText, string startNode)
    {
        dialogMap = TweeParser.Parse(tweeText);

        // foreach (KeyValuePair<string, DialogLine> line in dialogMap)
        // {

        // }

        Debug.Log("start dialog trigger");

        GoToNode(startNode);
    }

    void GoToNode(string nodeName)
    {
        if (!dialogMap.TryGetValue(nodeName, out var node))
        {
            return;
        }

        currentNode = nodeName; // <-- Track the current node
        Debug.Log("node current = " + currentNode);
        currentLines = new Queue<DialogLine>();

        foreach (var rawLine in node.Lines)
        {
            var colonIndex = rawLine.IndexOf(':');
            var speaker = colonIndex >= 0 ? rawLine[..colonIndex].Trim() : "Narrator";
            var text = colonIndex >= 0 ? rawLine[(colonIndex + 1)..].Trim() : rawLine;
            var line = new DialogLine { Speaker = speaker, Text = text };
            if (!string.IsNullOrWhiteSpace(text))
            {
                currentLines.Enqueue(line);
                lines.Add(line);
            }
        }

        nextNode = node.Next;
        Debug.Log("node next = " + nextNode);
        ShowNextLine();
    }

    // public void ShowNextLine()
    // {
    //     if (currentLines.Count > 0)
    //     {
    //         var line = currentLines.Dequeue();
    //         speakerName.text = line.Speaker;
    //         dialogText.text = line.Text;

    //         // Only show the Continue button if more lines or choices exist
    //         if (currentLines.Count > 0 || HasChoices(currentNode))
    //         {
    //             continueButton.gameObject.SetActive(true);
    //         }
    //         else
    //         {
    //             continueButton.gameObject.SetActive(false);
    //         }
    //     }
    //     else
    //     {
    //         if (HasChoices(currentNode))
    //         {
    //             ShowChoices(dialogMap[currentNode].Choices);
    //         }
    //         else if (!string.IsNullOrEmpty(nextNode))
    //         {
    //             GoToNode(nextNode);
    //         }
    //         else
    //         {
    //             EndDialog();
    //         }
    //     }
    // }

    public void ShowNextLine()
    {
        if (currentLines.Count > 0)
        {
            var line = currentLines.Dequeue();
            speakerName.text = line.Speaker;
            currentFullText = line.Text;

            if (revealCoroutine != null)
            {
                StopCoroutine(revealCoroutine);
            }

            revealCoroutine = StartCoroutine(RevealText(currentFullText));

        }
        else
        {
            if (HasChoices(currentNode))
            {
                ShowChoices(dialogMap[currentNode].Choices);
            }
            else if (!string.IsNullOrWhiteSpace(nextNode))
            {
                GoToNode(nextNode);
                Debug.Log("line trigger next = " + nextNode);
            }
            else
            {
                EndDialog();
                Debug.Log("end dialog trigger");

            }
        }
    }

    private IEnumerator RevealText(string text)
    {
        isRevealing = true;
        dialogText.text = "";
        foreach (char c in text)
        {
            dialogText.text += c;
            yield return new WaitForSeconds(0.02f); // typing speed
        }
        isRevealing = false;
        continueButton.gameObject.SetActive(true);
    }

    void ShowChoices(List<(string text, string target)> choices)
    {
        foreach (Transform child in choiceContainer.transform)
        {
            if (child.gameObject.name != "Continue")
                Destroy(child.gameObject);
        }

        foreach (var (text, target) in choices)
        {
            var btn = Instantiate(choiceButtonPrefab, choiceContainer.transform);
            btn.GetComponentInChildren<TextMeshProUGUI>().text = text;
            btn.onClick.AddListener(() =>
            {
                choiceContainer.SetActive(false);
                GoToNode(target);
                Debug.Log("line trigger choice = " + target);

            });
        }

        choiceContainer.SetActive(true);
    }

    void EndDialog()
    {
        speakerName.text = "";
        dialogText.text = "";
        Debug.Log("ending dialog");
        CheckEventEndTrigger();
    }

    public void CheckEventEndTrigger() // todo optimize later if I have really complex dialog trees?
    {
        foreach (var eventThing in eventTriggers)
        {
            if (eventThing.endTrigger)
            {
                eventThing.CheckTrigger(this, null, false, true);
                //eventTriggers.Remove(eventThing);
                break;
            }
        }
    }
}


[Serializable]
public class DialogEvent
{
    public string lineTrigger;
    public bool endTrigger;
    public bool startTrigger;
    public UnityEvent playEvent;

    public TextAsset textAsset;
    public string startNode;

    void TriggerEvent(DialogManager dm)
    {
        playEvent?.Invoke();
        if (textAsset != null)
        {
            dm.TriggerSequence(textAsset, startNode);
        }
    }

    public bool CheckTrigger(DialogManager dm, string line, bool start = false, bool end = false)
    {
        if (line != null && line == lineTrigger)
        {
            TriggerEvent(dm);
            return true;
        }
        else if (start || end)
        {
            TriggerEvent(dm);
            return true;
        }
        else
        {
            return false;
        }
    }
}
